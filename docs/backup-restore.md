# Backup and restore

## Back up

```bash
./scripts/backup.sh
```

- Runs `pg_dump -Fc` inside the postgres container and writes `backups/budget-YYYYMMDD-HHMMSS.dump` with mode 600.
- Keeps the newest `BACKUP_RETENTION` files (14 by default) and deletes older ones.
- Exits non-zero on failure, so cron can email you.

To run it nightly at 02:00, add this to the crontab of the user who owns `/opt/home-budget`:

```cron
0 2 * * * cd /opt/home-budget && ./scripts/backup.sh
```

**Copy backups somewhere else** (another machine, a NAS, or cloud storage with `rclone` or `restic`). Backups that stay on the server's disk are lost with it.

The in-app data export (Settings → Data) is handy for spreadsheets but is not a substitute for database backups.

## Restore

```bash
./scripts/restore.sh backups/budget-20261004-020000.dump
```

The script asks you to type `RESTORE`, then:

1. stops the backend,
2. runs `pg_restore --clean --if-exists`, replacing every table with the backup's contents,
3. starts the backend, which applies any migrations newer than the backup.

## Test a restore (recommended monthly)

Restore into a scratch database so the live data isn't touched:

```bash
docker compose exec postgres createdb -U budget restore_test
docker compose exec -T postgres pg_restore --no-owner -U budget -d restore_test < backups/<file>.dump
docker compose exec postgres psql -U budget -d restore_test -c "SELECT count(*) FROM transactions;"
docker compose exec postgres dropdb -U budget restore_test
```

If the count looks right, your backups work.

## Moving to a new major PostgreSQL version

Data files from one major version can't be read by the next, so upgrading (say 16 → 17) means dump and restore:

1. Run `./scripts/backup.sh`.
2. Run `docker compose down`, keeping the volume.
3. Rename the old volume or keep a copy. Change the image in `docker-compose.yml` to the new version and remove the old `pgdata` volume. **Only do this once the backup has been verified.**
4. Run `docker compose up -d postgres`, then `./scripts/restore.sh backups/<file>.dump`.
