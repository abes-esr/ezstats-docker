FROM node:18.16.0
LABEL maintainer="ezPAARSE Team <ezpaarse@couperin.org>"

ENV DEBIAN_FRONTEND noninteractive
ENV NODE_ENV production
ENV DOCKER_ENV 1
ENV PATH /opt/ezpaarse/bin:/opt/ezpaarse/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:/usr/local/sbin:$PATH

RUN npm install -g @ezpaarse-project/ezpaarse
#RUN npm install -g @ezpaarse-project/ezmesure

WORKDIR /home/node/

#OK: curl -X POST http://ezstats-ezpaarse:59599 -F "files[]=@./logtheses/data/mini.log" -o result.csv
#OK : ezp process mini.log -v -h ezstats-ezpaarse:59599
# ezp bulk -r logtheses/data/thesesfr/logs/ logtheses/data/thesesfr/results/ -H "Force-Parser: thesesfr" -H "filter-platforms: thesesfr" -H "ezPAARSE-Middlewares: thesesfr" -H "Output-Fields: +etabSoutenanceN,+etabSoutenancePpn" -H "Log-Format-apache: %h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-Agent}<.*>\" \"%{Shib-Identity-Provider}i\" \"%{eppn}i\" \"%{primary-affiliation}i\" \"%{supannEtablissement}i\""

#CMD ["ezp bulk -r logtheses/data/thesesfr/logs/ logtheses/data/thesesfr/results/"]