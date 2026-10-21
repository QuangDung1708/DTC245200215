#!/bin/bash
set -e
# This file runs only on the first creation of the database volume.
# For this classroom example, set MYSQL_EXPORTER_PASSWORD to a strong hexadecimal string.
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD}"
mysql -uroot --protocol=socket <<SQL
CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY '${MYSQL_EXPORTER_PASSWORD}' WITH MAX_USER_CONNECTIONS 3;
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';
SQL
unset MYSQL_PWD
