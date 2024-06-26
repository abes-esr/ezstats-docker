FROM alpine:latest as ezstats-batch-log
RUN apk add --no-cache --update docker openrc jq
RUN rc-update add docker boot

RUN echo "6    0       *       *       *       cd / && sh zip.sh" >> /var/spool/cron/crontabs/root

RUN apk add --no-cache --update tzdata
ENV TZ="Europe/Paris"
COPY ./entrypoint.sh /
COPY ./zip.sh /
RUN chmod +x /entrypoint.sh
RUN chmod +x /zip.sh
ENTRYPOINT ["/entrypoint.sh"]