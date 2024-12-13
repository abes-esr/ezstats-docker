# ezstats-docker
Configuration Docker 🐋 de l'application EZ Stats




[![Docker Pulls](https://img.shields.io/docker/pulls/abesesr/ezstats.svg)](https://hub.docker.com/r/abesesr/ezstats/)

EZStats-docker est un outil en charge des statistiques d'usages à l'aide d’ezPAARSE et ezMESURE __Cet outil est destiné à un usage interne de l'Abes.__

Ce dépôt contient la configuration docker 🐳 pour déployer l'application EZStats en local sur le poste d'un développeur, ou bien sur les serveurs de test et prod.

## URLs d'EZStats

Les URLs correspondantes aux déploiements en local, test et prod sont les suivantes :

- local : 
  - http://lap-TRI.levant.abes.fr:59599
  - http://lap-TRI.levant.abes.fr:58080
- dev : 
  - https://ezstats-dev.abes.fr/
  - https://ezstats-dev.abes.fr/webdav/
- test : 
  - https://ezstats-test.abes.fr/
  - https://ezstats-test.abes.fr/webdav/
- prod : 
  - https://ezstats.abes.fr/
  - https://ezstats.abes.fr/webdav/

Le téléchargement de fichier depuis WebDav, par Windows (lecteur réseau) est limité à 47 Mo.  
Si le fichier est plus gros, il faut passer par un navigateur web et faire "Enregistrer la cible sous..."

## Prérequis

Disposer de :
- ``docker``
- ``docker-compose``

## Installation

- Déployer la configuration docker dans un répertoire :
```bash
# La variable $INSTALL est pour nos serveurs de dev/test/prod, /opt/pod . En local, le chemin peut être différent (ex : si on utilise Windows).
cd $INSTALL
git clone https://github.com/abes-esr/ezstats-docker.git
```

- Configurer l'application depuis l'exemple du [fichier ``.env-dist``](./.env-dist) (ce fichier contient la liste des variables) :
```bash
cd $INSTALL/ezstats-docker/
cp .env-dist .env
```
personnaliser alors le contenu du .env

- Créer le répertoire contenant les logs (_défini dans le .env par les variables :
EZSTATS_VOLUME_DEVICE et EZSTATS_LOGSTASH_VOLUME_DEVICE_)   
Ce répertoire de log (dans le .env-dist, $INSTALL/ezstats-logs) doit avoir 2 sous répertoires : data/thesesfr/logs et data/thesesfr/results.  
Le répertoire data/thesesfr/logs contiendra les fichiers de logs et le répertoire data/thesesfr/results contiendra les fichiers générés par EZPaarse

Erreur possible si le répertoire n'est pas trouvé :
```bash
"Error response from daemon : failed to mount local volume : 
mount /run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Ubuntu/42282d145e43b6c89fdd0323e81c2d6163d636aedc75eb507a698be98fdf5b7b :/var/lib/docker/volumes/ezstats-docker_ezstats-logs/_data, flags : 0x1000 : no such file or directory"
Alors il faut vérifier que le répertoire contenant les logs est bien existant.
```

- Retours à la ligne à changer si installation sous Windows :  
Ouvrir avec un éditeur de texte le fichier webdav/docker-entrypoint.sh et changer "Windows CR+LF" en "UNIX LF" pour le fichier : webdav/docker-entrypoint.sh


- Ajouter les utilisateurs du WebDav, pour cela lancer cette commande, ils auront des droits en lecture et écriture  :  
```bash 
htdigest user.passwd WebDAV {Nom de famille de l'utilisateur}
```

## Démarrage et arrêt

```bash
# pour démarrer l'application (ou pour appliquer des modifications faites dans $INSTALL/ezstats-docker/.env)
cd $INSTALL/ezstats-docker/

docker-compose up -d
```

Remarque : retirer le ``-d`` pour voir passer les logs dans le terminal et utiliser alors CTRL+C pour stopper l'application

```bash
cd $INSTALL/ezstats-docker/

# pour stopper l'application
docker-compose stop


# pour redémarrer l'application
docker-compose restart


# pour supprimer les données :

docker-compose down -v 

```

## Supervision

```bash
# pour visualiser les logs de l'appli
cd $INSTALL/ezstats-docker/
docker-compose logs -f --tail=100
```

Cela va afficher les 100 dernière lignes de logs générées par l'application et toutes les suivantes jusqu'au CTRL+C qui stoppera l'affichage temps réel des logs.


## Configuration

Pour configurer l'application, vous devez créer et personnaliser un fichier ``$INSTALL/ezstats-docker/.env`` (cf section [Installation](#installation)). Les paramètres à placer dans ce fichier ``.env`` sont indiqués dans le fichier [``.env-dist``](https://github.com/abes-esr/ezstats-docker/blob/develop/.env-dist)

### Allocation de ressources pour les conteneurs

Pour ajuster l'allocation de ressources pour les conteneurs (par exemple, mémoire, CPU), vous pouvez définir la valeur des variables d'environnement suivantes dans votre fichier ``.env`` :

- `EZSTATS_MEM_LIMIT`: Mémoire allouée au conteneur ezpaarse (par exemple: "512m" pour 512 Mo), valeur par défaut "5g".
- `EZSTATS_MEMSWAP_LIMIT`: Quantité totale de mémoire et de swap que le conteneur est autorisé à utiliser. Si vous définissez cette valeur à 0, cela signifie que le swap est désactivé pour le conteneur.
- `EZSTATS_CPU_LIMIT`: CPU alloué au conteneur ezpaarse (par exemple: "0.5" pour allouer 50% d'un CPU), valeur par défaut "5".

Ces valeurs ne sont que des exemples. Ajustez-les selon vos besoins et les ressources disponibles sur votre machine ou votre serveur.

## Déploiement continu

Les objectifs des déploiements continus de EZStats sont les suivants (cf [poldev](https://github.com/abes-esr/abes-politique-developpement/blob/main/01-Gestion%20du%20code%20source.md#utilisation-des-branches)) :
- git push sur la branche ``develop`` provoque un déploiement automatique sur le serveur ``diplotaxis6-dev``
- git push (le plus couramment merge) sur la branche ``main`` provoque un déploiement automatique sur le serveur ``diplotaxis6-test``
- git tag X.X.X (associé à une release) sur la branche ``main`` permet un déploiement (non automatique) sur le serveur ``diplotaxis6-prod``

EZStats est déployé automatiquement en utilisant l'outil WatchTower. Pour permettre ce déploiement automatique avec WatchTower, il suffit de positionner à ``false`` la variable suivante dans le fichier ``/opt/pod/ezstats-docker/.env`` :
```env
EZSTATS_WATCHTOWER_RUN_ONCE=false
```

Le fonctionnement de watchtower est de surveiller régulièrement l'éventuelle présence d'une nouvelle image docker de ``ezstats-wikibase``, si oui, de récupérer l'image en question, de stopper le ou les les vieux conteneurs et de créer le ou les conteneurs correspondants en réutilisant les mêmes paramètres ceux des vieux conteneurs. Pour le développeur, il lui suffit de faire un git commit+push par exemple sur la branche ``develop`` d'attendre que la github action build et publie l'image, puis que watchtower prenne la main pour que la modification soit disponible sur l'environnement cible, par exemple la machine ``diplotaxis6-dev``.

Le fait de passer ``EZSTATS_WATCHTOWER_RUN_ONCE`` à false va faire en sorte d'exécuter périodiquement watchtower. Par défaut cette variable est à ``true`` car ce n'est pas utile voir cela peut générer du bruit dans le cas d'un déploiement sur un PC en local.

## Sauvegardes

Les éléments suivants sont à sauvegarder:
- ``$INSTALL/ezstats-docker/.env`` : contient la configuration spécifique de notre déploiement
- ``$INSTALL/ezstats-docker/ezstats-logs`` : contient les logs quotidiens

/!\ A noter : le répertoire ``$INSTALL/ezstats-docker/ezstats-logs`` est un montage NFS.

### Restauration depuis une sauvegarde

Réinstallez l'application EZStats depuis la [procédure d'installation ci-dessus](#installation) et récupéré depuis les sauvegardes le fichier ``.env`` et placez le dans ``$INSTALL/ezstats-docker/.env`` sur la machine qui doit faire repartir EZStats.

Relancer le traitement de tous les logs :

Lancer la commande :
```bash
cd $INSTALL/ezstats-docker/
```

### Mise à jour de la dernière version

Pour récupérer et démarrer la dernière version de l'application vous pouvez le faire manuellement comme ceci :
```bash
docker-compose pull
docker-compose up
```
Le ``pull`` aura pour effet de télécharger l'éventuelle dernière images docker disponible pour la version glissante en cours (ex: ``develop`` ou ``main``). Sans le pull c'est la dernière image téléchargée qui sera utilisée.

Ou bien [lancer le conteneur ``ezstats-watchtower``](https://github.com/abes-esr/ezstats-docker/blob/develop/README.md#d%C3%A9ploiement-continu) qui le fera automatiquement toutes les quelques secondes pour vous.

## Rejouer les logs

1) Supprimer les logs copiés et anonymisés provenant Logstash :
```bash
sudo docker exec ezstats-batch-logs sh -c "rm -fr /home/node/logtheses/logs/data/thesesfr/logs/*"
```

2) Supprimer les résultats du traitement EZPaarse et du chargement EZMesure :
```bash
sudo docker exec ezstats-batch-logs sh -c "rm -fr /home/node/logtheses/logs/data/thesesfr/results/*"
```

3) Relancer l'anonymisation des logs Logstash :
```bash
sudo docker exec -it ezstats-batch-logs sh 
date
```
Puis, récupérer les minutes et l'heure et mettre à jour le crontab pour zip.sh, afin qu'il se lance une minute plus tard
```bash
crontab -e
```

4) Rejouer les logs du 01 au 15 mars 2024 avec recupRaw.sh et du 30 septembre au 10 octobre avec recupRaw0924.sh 
```bash
sudo docker exec -it ezstats-batch-logs sh 
./recupRaw.sh
./recupRaw0924.sh
```

5) Relancer le traitement des logs par EZPaarse :
```bash
sudo docker exec -it ezstats-batch-theses bash 
date
```
Puis, récupérer les minutes et l'heure et mettre à jour le crontab pour launch-ezp.sh, afin qu'il se lance une minute plus tard
```bash
crontab -e
```
On peut modifier, dans launch-ezp.sh, les paramètres :  
`-H "thesesfr-base-wait-time: 10" \ `  
`-H "thesesfr-throttle: 10" \  `  
afin que le temps entre 2 appels à l'API theses.fr soit plus court (par défaut : 1000 ms et 100 ms).


6) Effacer l'index (indice) EZMesure :

```bash
sudo docker exec -it ezstats-batch-theses bash 
ezmesure -u https://ezmesure.couperin.org/api -t "${EZMESURE_TOKEN}" indices delete z-abes-ezpaarse-thesesfr
```

7) Relancer le traitement des logs par EZMesure :
```bash
sudo docker exec -it ezstats-batch-theses bash 
date
```
Puis, récupérer les minutes et l'heure et mettre à jour le crontab pour launch-ezm.sh, afin qu'il se lance une minute plus tard
```bash
crontab -e
```



## Architecture

<img alt="schéma d'architecture" src="https://docs.google.com/drawings/d/e/2PACX-1vR4EXYWBmah6Jeh1FJWdL_sVCiwUjtShgdIc0Uaa64bmpRFgH0wJGjQJhezEYRhzxGJYs0rVV_-5Qvv/pub?w=1135&h=564">

([lien](https://docs.google.com/drawings/d/1ixoo9xEQD0p1jGV9T_CraN0o7vDaFLlZz2QjQSRJBhU/edit) pour modifier le schéma - droits requis)

Les images d'ezstats-batch-theses et d'ezstats-batch-logs sont ici :
- https://github.com/abes-esr/ezstats-batch-theses
- https://github.com/abes-esr/ezstats-batch-logs

La configuration de BiblioMap pour theses.fr est ici : 
- https://github.com/abes-esr/ezstats-bibliomap-theses

Les codes sources d'EZPaarse (et lib NodeJS), EZMesure (et lib NodeJS) et EZReport (maintenus par l'INIST) sont ici : 
- https://github.com/ezpaarse-project/ezpaarse
- https://github.com/ezpaarse-project/node-ezpaarse
- https://github.com/ezpaarse-project/ezmesure
- https://github.com/ezpaarse-project/node-ezmesure
- https://github.com/ezpaarse-project/ezreeport
