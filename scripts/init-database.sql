-- Инициализация локальной среды PostgreSQL для корпоративного мессенджера.
-- Выполняется один раз от имени суперпользователя postgres:
--   psql -U postgres -f scripts/init-database.sql

-- Создание выделенного пользователя приложения.
-- CREATEDB необходим Prisma Migrate для создания теневой базы данных при разработке.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'messenger_user') THEN
    CREATE ROLE messenger_user WITH LOGIN PASSWORD 'messenger_password' CREATEDB;
  END IF;
END
$$;

-- Создание базы данных приложения
SELECT 'CREATE DATABASE corp_messenger OWNER messenger_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'corp_messenger')\gexec

-- Назначение привилегий пользователю приложения
GRANT ALL PRIVILEGES ON DATABASE corp_messenger TO messenger_user;
