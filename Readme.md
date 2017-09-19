
# CouchDB cluster manager (commandline tool / docker image)

This is a Docker image that when run will initialize a set of couchdb instances to form a cluster. 

WIP. TODO: Extend this to be a proper cluster manager commandline tool.

# Usage example

##### On each server, start CouchDB (here is an example using docker and a private IP 10.0.1.1):
```
docker run -d -e NODENAME=10.0.1.1 -v couch:/opt/couchdb \
  -p 5984:5984 -p 5986:5986 -p 4369:4369 -p 9100:9100 \
  --name couch \
  -e ERL_FLAGS="-setcookie chanegeMeThisIsASharedSecretCookie" \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=secretRelaxingPassword \
  tobyfoo/couchdb:2.1.0
  
```
- The NODENAME env parameter will be used by the CouchDB instance to communicate with each other. Use either an IP address or a DNS name. In this example 10.0.1.1, 10.0.1.2 and 10.0.1.3 are the three servers used to cluster.
- The communication between nodes is without encryption etc. so this would be an internal network or even a IPSec tunnel, ideally. (Upon cluster setup, CouchDB instances send the Erlang cookie and admin password accross the network in plain text!)
- Change the setcookie parameter to something secret, don't just copy-paste from example above :P
- Trim the published ports to something more secure. The usual port 5984 is used for clients to connect to CouchDB. This port and the others are needed for the nodes to communicate with each other in order to cluster. They should not be publicly accessible!

##### Then, on one server, any server:
```
docker run -it --rm \
  -e COUCHDB_CLUSTER_NODES=10.0.1.1,10.0.1.2,10.0.1.3 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=secretRelaxingPassword \
  tobyfoo/couchdb-cluster-manager
```
- COUCHDB_CLUSTER_NODES is a comma-separated list of CouchDB nodes. Optionally you can include a port like so, 10.1.2.3:5984.
- The COUCHDB_USER and COUCHDB_PASSWORD is the CouchDB instance's admin password, it should be the same for all CouchDB instances.

#### More info
Tested on CouchDB 2.1.0, based on https://github.com/apache/couchdb-setup and https://github.com/apache/couchdb-docker.
 