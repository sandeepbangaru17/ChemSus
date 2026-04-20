#!/bin/bash
# ChemSus SQLite backup script
# Setup cron: crontab -e, add:
#   0 2 * * * /home/pavankumar/ChemSus/scripts/backup-db.sh >> /home/pavankumar/ChemSus/logs/backup.log 2>&1

DB_SRC="/home/pavankumar/ChemSus/db/chemsus.sqlite"
BACKUP_DIR="/home/pavankumar/ChemSus/db/backups"
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DEST="$BACKUP_DIR/chemsus_$TIMESTAMP.sqlite"

if [ ! -f "$DB_SRC" ]; then
  echo "[$TIMESTAMP] ERROR: Source DB not found at $DB_SRC"
  exit 1
fi

cp "$DB_SRC" "$DEST"
if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$DEST" | cut -f1)
  echo "[$TIMESTAMP] Backup OK: $DEST ($SIZE)"
else
  echo "[$TIMESTAMP] ERROR: Backup failed"
  exit 1
fi

# Remove backups older than KEEP_DAYS days
find "$BACKUP_DIR" -name "chemsus_*.sqlite" -mtime +$KEEP_DAYS -delete
REMAINING=$(ls "$BACKUP_DIR" | wc -l)
echo "[$TIMESTAMP] Backups retained: $REMAINING"
