#!/bin/sh

{ echo ""; \
  echo "# EZP Bulk"; \
  echo "* * * * * /home/node/launch-ezp.sh >> /home/node/launch-ezp.log 2>&1"; \
	} | crontab -

# start cron
echo "Starting cron..."
service cron start

exec "$@"