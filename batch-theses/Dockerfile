FROM node:18.16.0 AS ezstats-batch-theses-image
LABEL maintainer="ezPAARSE Team <ezpaarse@couperin.org>"

ENV DEBIAN_FRONTEND noninteractive
ENV NODE_ENV production
ENV DOCKER_ENV 1
ENV PATH /opt/ezpaarse/bin:/opt/ezpaarse/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:/usr/local/sbin:$PATH

WORKDIR /home/node/

RUN npm install -g @ezpaarse-project/ezpaarse
#RUN npm install -g @ezpaarse-project/ezmesure

RUN apt-get update && apt-get install -y vim && apt-get install -y cron

#=== Set custom entrypoint ===
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

#=== Shell to launch ezp bulk programm ===
COPY launch-ezp.sh /home/node
RUN chmod +x /home/node/launch-ezp.sh

ENTRYPOINT [ "docker-entrypoint.sh" ]
