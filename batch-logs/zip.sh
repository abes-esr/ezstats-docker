#!/bin/bash
##chemin vers le point de montage ezstats-logs:/log

RESULT_DIR="/home/node/logtheses/logs/2024"
mkdir -p "$RESULT_DIR"


cd ${RESULT_DIR}
for LOG_FILE in $(ls /home/node/logstash/*/*/logstash-* | grep -vE "\.raw\.log$")
do
                Logresult="${LOG_FILE#$(dirname "$(dirname "$LOG_FILE")")/*/}"
                if [ ! -f ${LOG_FILE}.raw.log ]; then
                        cat ${LOG_FILE} | \
                        jq -r 'select(.container.name == "theses-rp") | .event.original' | \
                        grep -v -E "^20[0-9]{2}-[0-9]{2}-[0-9]{2}" \
                        > "${RESULT_DIR}/${Logresult}.raw.log"
                fi

                for Logdir in *; do
                        if [ -f "$Logdir" ]; then
                        mkdir -p "${Logdir:30:2}"
                        fi
                done

                for Logdir in *; do
                        if [ -f "$Logdir" ]; then
                        mv "$Logdir" "${Logdir:30:2}/"
                        fi
                done


done