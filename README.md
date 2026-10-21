# UniForum — Đề tài 15 (Ubuntu 26.04 LTS trên VMware)

Đây là **mã nguồn mẫu để thực hành** cho môn Triển khai và Quản trị Hệ thống Phần mềm: Diễn đàn/Cộng đồng (Forum), MySQL + phpMyAdmin, Nginx, Prometheus, Grafana, Loki, Promtail và Docker Compose. **Các lệnh bên dưới chạy trong Terminal Ubuntu, không chạy bằng PowerShell**. Bạn vẫn phải kiểm tra thực tế, tạo ảnh chụp và hiểu các thành phần trước khi nộp.

## Máy của bạn đã xác nhận

- Ubuntu 26.04 LTS chạy trong VMware Workstation.
- Docker Engine 29.7.2; Docker Compose v5.4.0; Git 2.53.0.
- Docker được cài bằng Snap, DockerRootDir = `/var/snap/docker/common/var-lib-docker`.
- Port `8080`, `8081`, `3001`, `9090` chưa phát hiện bị dùng tại lúc kiểm tra.
- Máy ảo có ~5.2 GiB RAM; **khởi động theo giai đoạn** để giảm nguy cơ quá tải.
- Giữ nguyên các container bài tập cũ (`postgres_db`, `mysql_db`, `nginx_proxy`), không dùng `docker system prune --volumes` hay `docker compose down -v` nếu chưa hiểu hậu quả.
## Cài đặt trực tiếp từ GitHub (khuyến nghị)
Mã nguồn UniForum được quản lý tại:
https://github.com/QuangDung1708/DTC245200215

### 1. Tải mã nguồn trên Ubuntu

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/QuangDung1708/DTC245200215.git
cd DTC245200215
```

### 2. Cấu hình môi trường

```bash
cp .env.example .env
nano .env
```

Thay các mật khẩu mẫu bằng mật khẩu mạnh trước khi
chạy hệ thống. Không đưa file .env lên GitHub.

### 3. Khởi chạy hệ thống

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

### 4. Truy cập các dịch vụ

- Website: http://localhost:8080
- phpMyAdmin: http://localhost:8081
- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090

Lưu ý: Các lệnh trên áp dụng cho một môi trường
Ubuntu mới, chưa có thư mục DTC245200215.

## A. Đưa file vào Ubuntu, giải nén

1. Bên trong Ubuntu mở **Firefox** → đăng nhập ChatGPT bằng cùng tài khoản → mở cuộc trò chuyện → tải **UniForum_DeTai15_Ubuntu_VMware.zip** trực tiếp trong Ubuntu.
2. Trong Terminal Ubuntu:

```bash
ls -lh "$HOME/Downloads/UniForum_DeTai15_Ubuntu_VMware.zip"
unzip -v >/dev/null || sudo apt install -y unzip
mkdir -p "$HOME/projects"
unzip "$HOME/Downloads/UniForum_DeTai15_Ubuntu_VMware.zip" -d "$HOME/projects"
cd "$HOME/projects/uniforum"
pwd
ls -la
```

Nếu Firefox đặt file ở thư mục tải xuống khác, thay đường dẫn tương ứng. Nếu bạn kéo thả file từ Windows sang Ubuntu, kiểm tra vị trí file trước khi chạy.

## B. Tạo file mật khẩu riêng (không đưa lên GitHub)

```bash
cp .env.example .env
python3 - <<'PYTHON'
from pathlib import Path
import secrets
p = Path('.env')
keys = {'MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'MYSQL_EXPORTER_PASSWORD', 'SESSION_SECRET', 'GRAFANA_ADMIN_PASSWORD'}
lines = p.read_text().splitlines()
updated = []
for line in lines:
    key, sep, val = line.partition('=')
    updated.append(f'{key}={secrets.token_hex(24)}' if sep and key in keys else line)
p.write_text('\n'.join(updated) + '\n')
PYTHON
chmod 600 .env
docker compose config --quiet
```

Không in `.env` ra ảnh chụp báo cáo; trong đó có mật khẩu. Giữ `MYSQL_DATABASE=uniforum` vì `db/init.sql` dùng tên này.

## C. Chỉ khởi chạy website, MySQL, phpMyAdmin và Nginx trước

```bash
docker compose up -d --build db web nginx phpmyadmin
docker compose ps
curl -I http://localhost:8080
```

**Trong Firefox của máy ảo Ubuntu:**

- `http://localhost:8080`: Website UniForum.
- `http://localhost:8080/register`: Đăng ký tài khoản rồi đăng nhập.
- `http://localhost:8081`: phpMyAdmin (dùng `MYSQL_USER` và `MYSQL_PASSWORD` trong `.env`).

Sau khi đăng nhập hãy **tạo chủ đề → đăng bài → bình luận → mở phpMyAdmin** kiểm tra bốn bảng `users`, `topics`, `posts`, `comments`.

Nếu có lỗi, chạy:

```bash
docker compose ps -a
docker compose logs --tail=80 db web nginx phpmyadmin
```

**Không chạy lại MySQL container cũ**: UniForum có service `db` và volume `uniforum_mysql_data` tách biệt; cổng 3306 không được công khai ra host.

## D. Khởi chạy thành phần giám sát (làm sau khi C thành công)

```bash
docker compose up -d nginx-exporter mysql-exporter cadvisor prometheus loki promtail grafana
docker compose ps
```

- Prometheus: `http://localhost:9090/targets` → kiểm tra target `webapp`, `mysql`, `nginx`, `prometheus`, `cadvisor`.
- Grafana: `http://localhost:3001` → đăng nhập bằng `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` trong `.env` → Dashboards → UniForum.
- Nếu `cadvisor` báo lỗi, xem `docker compose logs --tail=80 cadvisor`; vì cài Docker qua Snap nên compose đã dùng biến `DOCKER_ROOT_DIR` tùy môi trường.
- Nếu thiếu RAM, dừng trước và xem `free -h`, `docker stats --no-stream`; không vội xóa dữ liệu.

PromQL mẫu:

```promql
up
uniforum_http_requests_total
mysql_up
nginx_connections_active
container_memory_working_set_bytes
```

Trong Grafana → Explore chọn Loki, chạy **ít nhất 3 LogQL**:

```logql
{job="webapp"}
{job="nginx"} |= "GET"
{job="webapp"} |~ "status=(404|500)"
```

Để có log 404, mở trang `/khong-ton-tai` trên website, sau đó chạy query và chọn Last 15 minutes.

**Lưu ý:** Promtail đã hết hỗ trợ từ tháng 3/2026, nhưng vẫn dùng để làm đúng yêu cầu môn học; một dự án mới trong thực tế nên ưu tiên Grafana Alloy.

## E. Kiểm tra bảo mật và chụp ảnh minh chứng

```bash
docker compose exec web id
docker compose exec web sh -c 'touch /test-write-file'
curl -I http://localhost:8080
docker compose ps
```

Kết quả mong đợi: web chạy user không phải root; `touch /test-write-file` thất bại vì filesystem read-only; có security headers HTTP. DB không mở cổng 3306 ra ngoài. Mật khẩu trong `.env` không đưa vào GitHub. Đây là ví dụ bảo mật trong phạm vi bài thực hành, **chưa phải chuẩn triển khai production**.

## F. GitHub, báo cáo, dọn dẹp an toàn

- Trên GitHub cần repo mang tên theo mã SV theo hướng dẫn giảng viên, README, nguồn app và các file cấu hình, cùng **ít nhất 3 commit có ý nghĩa**. Chỉ commit khi hoàn thành thay đổi thực sự; không tạo lịch sử giả.
- Báo cáo tối thiểu 10 trang, theo mẫu Word đã có: Chương 1 Kiến trúc + GitHub; Chương 2 Website/DB/Nginx; Chương 3 Prometheus/Grafana/Loki; Chương 4 Hardening; Kết luận. Dùng ảnh chụp thật trong Ubuntu.
- Dừng riêng dự án UniForum: `docker compose stop`; khởi động lại: `docker compose start`.
- `docker compose down` loại bỏ container/network trong dự án nhưng giữ **named volumes** nếu không có `-v`. **Không chạy `docker compose down -v` khi muốn giữ dữ liệu diễn đàn**.

## Cấu trúc thư mục

```text
uniforum/
├── app/              # Node.js Express / EJS
├── db/               # SQL init, exporter
├── nginx/            # Reverse proxy và security headers
├── prometheus/      # Cấu hình scrape metrics
├── grafana/         # Data sources + dashboard
├── loki/            # Log server
├── promtail/        # Thu thập log web / nginx
├── compose.yaml     # Tất cả dịch vụ Docker
├── .env.example     # Mẫu biến môi trường; copy thành .env
└── README.md        # File này
```
