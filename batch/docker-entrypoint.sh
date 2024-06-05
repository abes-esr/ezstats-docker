#!/bin/sh

{ echo ""; \
  echo "# EZP Bulk"; \
  echo "* * * * * /home/node/launch-ezp.sh 1>/proc/1/fd/1 2>/proc/1/fd/2"; \
	} | crontab -

# start cron
echo "Starting EZP bulk cron..."
service cron start

exec "$@"