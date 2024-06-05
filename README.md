# ezstats-docker
Configuration Docker 🐋 de l'application EZ Stats




[![Docker Pulls](https://img.shields.io/docker/pulls/abesesr/ezstats.svg)](https://hub.docker.com/r/abesesr/ezstats/)

EZStats-docker est un outil en charge des statistiques d'usages à l'aide d’ezPAARSE et ezMESURE __Cet outil est destiné à un usage interne de l'Abes.__

Ce dépôt contient la configuration docker 🐳 pour déployer l'application EZStats en local sur le poste d'un développeur, ou bien sur les serveurs de test et prod.

## URLs d'EZStats

Les URLs correspondantes aux déploiements en local, test et prod de movies sont les suivantes :

- local :
    - http://lap-TRI.levant.abes.fr:59599 : homepage d'EZStats
- dev : 
- test :
- prod

## Prérequis

Disposer de :
- ``docker``
- ``docker-compose``

## Installation

Déployer la configuration docker dans un répertoire :
```bash
# adaptez /opt/pod/ avec l'emplacement où vous souhaitez déployer l'application
cd /opt/pod/
git clone https://github.com/abes-esr/ezstats-docker.git
chmod +x webdav/docker-entrypoint.sh
```

Configurer l'application depuis l'exemple du [fichier ``.env-dist``](./.env-dist) (ce fichier contient la liste des variables) :
```bash
cd /opt/pod/ezstats-docker/
cp .env-dist .env
# personnaliser alors le contenu du .env

Définir le mot de passe du compte admin pour WebDAV (qui aura les droits en lecture et écriture), et changer les autorisations du fichiers (644):
cd webdav
htdigest user.passwd WebDAV admin
chmod 644 user.passwd
```

## Démarrage et arrêt

```bash
# pour démarrer l'application (ou pour appliquer des modifications 
# faites dans /opt/pod/movies-docker/.env)
cd /opt/pod/ezstats-docker/

docker-compose up -d
```

Remarque : retirer le ``-d`` pour voir passer les logs dans le terminal et utiliser alors CTRL+C pour stopper l'application

```bash
cd /opt/pod/ezstats-docker/

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
cd /opt/pod/ezstats-docker/
docker-compose logs -f --tail=100
```

Cela va afficher les 100 dernière lignes de logs générées par l'application et toutes les suivantes jusqu'au CTRL+C qui stoppera l'affichage temps réel des logs.


## Configuration

Pour configurer l'application, vous devez créer et personnaliser un fichier ``/opt/pod/ezstats-docker/.env`` (cf section [Installation](#installation)). Les paramètres à placer dans ce fichier ``.env`` sont indiqués dans le fichier [``.env-dist``](https://github.com/abes-esr/ezstats-docker/blob/develop/.env-dist)

### Allocation de ressources pour les conteneurs

Pour ajuster l'allocation de ressources pour les conteneurs (par exemple, mémoire, CPU), vous pouvez définir la valeur des variables d'environnement suivantes dans votre fichier ``.env`` :

- `EZSTATS_MEM_LIMIT`: Mémoire allouée au conteneur movies (par exemple: "512m" pour 512 Mo), valeur par défaut "5g".
- `EZSTATS_MEMSWAP_LIMIT`: Quantité totale de mémoire et de swap que le conteneur est autorisé à utiliser. Si vous définissez cette valeur à 0, cela signifie que le swap est désactivé pour le conteneur.
- `EZSTATS_CPU_LIMIT`: CPU alloué au conteneur movies (par exemple: "0.5" pour allouer 50% d'un CPU), valeur par défaut "5".

Ces valeurs ne sont que des exemples. Ajustez-les selon vos besoins et les ressources disponibles sur votre machine ou votre serveur.

## Déploiement continu

Les objectifs des déploiements continus de EZStats sont les suivants (cf [poldev](https://github.com/abes-esr/abes-politique-developpement/blob/main/01-Gestion%20du%20code%20source.md#utilisation-des-branches)) :
- git push sur la branche ``develop`` provoque un déploiement automatique sur le serveur ``diplotaxis6-dev``
- git push (le plus couramment merge) sur la branche ``main`` provoque un déploiement automatique sur le serveur ``diplotaxis6-test``
- git tag X.X.X (associé à une release) sur la branche ``main`` permet un déploiement (non automatique) sur le serveur ``diplotaxis6-prod``

Movies est déployé automatiquement en utilisant l'outil WatchTower. Pour permettre ce déploiement automatique avec WatchTower, il suffit de positionner à ``false`` la variable suivante dans le fichier ``/opt/pod/ezstats-docker/.env`` :
```env
EZSTATS_WATCHTOWER_RUN_ONCE=false
```

Le fonctionnement de watchtower est de surveiller régulièrement l'éventuelle présence d'une nouvelle image docker de ``ezstats-wikibase``, si oui, de récupérer l'image en question, de stopper le ou les les vieux conteneurs et de créer le ou les conteneurs correspondants en réutilisant les mêmes paramètres ceux des vieux conteneurs. Pour le développeur, il lui suffit de faire un git commit+push par exemple sur la branche ``develop`` d'attendre que la github action build et publie l'image, puis que watchtower prenne la main pour que la modification soit disponible sur l'environnement cible, par exemple la machine ``diplotaxis6-dev``.

Le fait de passer ``EZSTATS_WATCHTOWER_RUN_ONCE`` à false va faire en sorte d'exécuter périodiquement watchtower. Par défaut cette variable est à ``true`` car ce n'est pas utile voir cela peut générer du bruit dans le cas d'un déploiement sur un PC en local.

## Sauvegardes

Les éléments suivants sont à sauvegarder:
- ``/opt/pod/ezstats-docker/.env`` : contient la configuration spécifique de notre déploiement
- ``/opt/pod/ezstats-docker/ezstats-logs`` : contient les logs quotidiens

/!\ A noter : le répertoire ``/opt/pod/movies-docker/ezstats-logs`` est un montage NFS.

### Restauration depuis une sauvegarde

Réinstallez l'application EZStats depuis la [procédure d'installation ci-dessus](#installation) et récupéré depuis les sauvegardes le fichier ``.env`` et placez le dans ``/opt/pod/ezstats-docker/.env`` sur la machine qui doit faire repartir EZStats.

Relancer le traitement de tous les logs :

Lancer la commande :
```bash
cd /opt/pod/ezstats-docker/
```

### Mise à jour de la dernière version

Pour récupérer et démarrer la dernière version de l'application vous pouvez le faire manuellement comme ceci :
```bash
docker-compose pull
docker-compose up
```
Le ``pull`` aura pour effet de télécharger l'éventuelle dernière images docker disponible pour la version glissante en cours (ex: ``develop`` ou ``main``). Sans le pull c'est la dernière image téléchargée qui sera utilisée.

Ou bien [lancer le conteneur ``ezstats-watchtower``](https://github.com/abes-esr/ezstats-docker/blob/develop/README.md#d%C3%A9ploiement-continu) qui le fera automatiquement toutes les quelques secondes pour vous.

## Architecture

<img alt="schéma d'architecture" src="https://docs.google.com/drawings/d/e/2PACX-1vR4EXYWBmah6Jeh1FJWdL_sVCiwUjtShgdIc0Uaa64bmpRFgH0wJGjQJhezEYRhzxGJYs0rVV_-5Qvv/pub?w=1135&h=564">

([lien](https://docs.google.com/drawings/d/1ixoo9xEQD0p1jGV9T_CraN0o7vDaFLlZz2QjQSRJBhU/edit) pour modifier le schéma - droits requis)

Les codes de source d'EZStats sont ici :
- https://github.com/ezpaarse-project/ezpaarse : Logiciel EZPaarse
- https://github.com/ezpaarse-project/ezmesure : Logiciel EZMesure
- https://github.com/ezpaarse-project/ezreeport : Logiciel EZReeport
