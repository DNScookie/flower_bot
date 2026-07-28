# Flower Bot

Телеграм-бот для личной группы, который назначает ответственного за полив комнатного растения и присылает напоминания.

## Настройка

1. Скопируй репозиторий на VPS.
2. В корне создайте файл `.env` или задайте переменную окружения `BOT_TOKEN`.

Пример `.env`:

```
BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

## Сборка и запуск

Собрать образ:

```bash
docker build -t flower-bot .
```

Запустить контейнер:

```bash
docker run -d --name flower-bot \
  -e BOT_TOKEN="<токен>" \
  -v $(pwd)/data.json:/app/data.json \
  flower-bot
```

Если у тебя Windows PowerShell, путь к volume задается так:

```powershell
docker run -d --name flower-bot `
  -e BOT_TOKEN="<токен>" `
  -v ${PWD}/data.json:/app/data.json `
  flower-bot
```

## Команды бота

- `/start` — приветствие и установка владельца
- `/help` — список команд
- `/set_interval <days>` — интервал полива
- `/set_time HH:MM` — время напоминаний
- `/add_member @username` — добавить участника
- `/remove_member @username` — удалить участника
- `/list_members` — показать очередь и настройки
- `/next` — показать текущего ответственного
- `/done` — отметить полив выполненным
- `/skip` — пропустить текущего
