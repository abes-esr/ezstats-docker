FROM node:18.16.0
LABEL maintainer="ezPAARSE Team <ezpaarse@couperin.org>"

ENV DEBIAN_FRONTEND noninteractive
ENV NODE_ENV production
ENV DOCKER_ENV 1
ENV PATH /opt/ezpaarse/bin:/opt/ezpaarse/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:/usr/local/sbin:$PATH

WORKDIR /home/node/

RUN npm install -g @ezpaarse-project/ezpaarse
#RUN npm install -g @ezpaarse-project/ezmesure

RUN apt-get update && apt-get install -y vim && apt-get install -y cron

#OK: curl -X POST http://ezstats-ezpaarse:59599 -F "files[]=@./logtheses/data/mini.log" -o result.csv
#OK : ezp process mini.log -v -h ezstats-ezpaarse:59599
# ezp bulk -r logtheses/data/thesesfr/logs/ logtheses/data/thesesfr/results/ -H "Force-Parser: thesesfr" -H "filter-platforms: thesesfr" -H "ezPAARSE-Middlewares: thesesfr" -H "Output-Fields: +etabSoutenanceN,+etabSoutenancePpn" -H "Log-Format-apache: %h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-Agent}<.*>\" \"%{Shib-Identity-Provider}i\" \"%{eppn}i\" \"%{primary-affiliation}i\" \"%{supannEtablissement}i\""

#=== Set custom entrypoint ===
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

#=== Shell to launch ezp bulk programm ===
COPY launch-ezp.sh /home/node
RUN chmod +x /home/node/launch-ezp.sh

ENTRYPOINT [ "docker-entrypoint.sh" ]