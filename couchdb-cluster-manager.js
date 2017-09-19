'use strict';

const test = require('tape');
const request = require('supertest');

const debug = (msg, obj) => console.log(msg, obj);

/*
  Script to instrument a set of CouchDB nodes to form a cluster

  TODO:
    - Hacked this using the tape unit test framework. While quick it was a bad idea:
      - Before looking at the code need to read https://github.com/substack/tape
      - Stdout/log output is not very intuitive
      - Won't stop on an error (a bad thing for this use-case?)
    - ...So, rewrite this using only superagent and some more helpful red/orange/green logging
    - When a cluster has already been formed rather check the the required list of nodes matches the set of nodes currently in the cluster, then
      - add nodes that are not present yet
      - potentially delete nodes (or display a warning and offer a --force switch?)
    - Only modify the cluster when a cla switch is present, else display cluster state and health
    - Offer to pass in the nodes list as either a CLA or the env, instead of only the env
    - Document undocumented hostInternal and portInternal feature, or remove completely if deemed unnecessary
 */

// ======= PARAMETERS =======

//This should be the list of CouchDB nodes which should form the cluster.
//Format is a comma-separated list of hostnames/IPs with optional posts, NODE1_HOSTNAME[:NODE1_PORT],NODE2_HOSTNAME
//e.g. 10.0.1.10:5984,10.0.2.10:5984,10.0.3.10
const nodesParameter = process.env.COUCHDB_CLUSTER_NODES;
if(!nodesParameter) throw new Error(`Missing parameter (via environment variable COUCHDB_CLUSTER_NODES`);

// CouchDB admin username and password. This should have been set equally for all nodes
const nodesAdminUsername = process.env.COUCHDB_USER;
const nodesAdminPassword = process.env.COUCHDB_PASSWORD;
if(!nodesAdminUsername) throw new Error(`Missing parameter (via environment variable COUCHDB_USER)`);
if(!nodesAdminPassword) throw new Error(`Missing parameter (via environment variable COUCHDB_PASSWORD)`);

// ==========================

test('Check and parse parameters', function(t) {

  const nodesList = nodesParameter.split(',');
  if(!nodesList || !nodesList.length) throw new Error(`Missing list of nodes`);

  const couchdbNodes = nodesList.map((nodeStr) => {
    let node = nodeStr.split(':');
    return {
      host: node[0],
      port: parseInt(node[1]) || 5984,
      hostInternal: node[2] || null,
      portInternal: node[3] || null
    }; //5984 being the default CouchDB port
  });

  t.test('Enable cluster mode in all nodes', (t) => {

    couchdbNodes.forEach((node) => {
      t.test(`Enable cluster mode in node ${node.host}`, (t) => {

        request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${node.host}:${node.port}`)
          .post('/_cluster_setup')
          .send({
            "action": "enable_cluster",
            "bind_address": "0.0.0.0",
            "username": nodesAdminUsername,
            "password": nodesAdminPassword,
            "node_count": String(couchdbNodes.length)
          })
          .expect('Content-Type', /json/)
          .expect((res) => {

            debug("Response status=", res.status);
            debug("Response body=", res.body);

            t.assert(res.body, "Response has a body");

            if(200 === res.status) {
              t.assert(true, "Cluster mode was successfully enabled")
            } else if(400 === res.status) {
              t.assert(res.body.reason === 'Cluster is already enabled', "Cluster mode was already enabled on this node");
            } else {
              t.assert(false, `_cluster_setup call failed, reason=${res.body.reason}`);
            }

          })
          .end(t.end);
      });

    });

    t.end();
  });

  t.test('Ensure all nodes are ready to form a cluster, i.e. they are not part of a cluster already', (t) => {
    couchdbNodes.forEach((node) => {
      t.test(`Check cluster state of node ${node.host}`, (t) => {
        request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${node.host}:${node.port}`)
          .get('/_cluster_setup')
          .expect(200)
          .expect('Content-Type', /json/)
          .expect((res) => {
            t.assert(res.body, "Response has a body");
            t.equal(res.body.state, 'cluster_enabled', "Node is in cluster_enabled state");
          })
          .end(t.end);
      });
    });
    t.end();
  });


  t.test('Using the first node as a coordinator node, create the cluster by calling enable_cluster and add_node for each other node', (t) => {

    const coordinatorNode = couchdbNodes[0];

    couchdbNodes.slice(1).forEach((node) => {

      t.test(`Adding node ${node.host}: enable_cluster call via coordinatorNode=${coordinatorNode.host}`, (t) => {
        request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${coordinatorNode.host}:${coordinatorNode.port}`)
          .post('/_cluster_setup')
          .send({
            "action": "enable_cluster",
            "bind_address": "0.0.0.0",
            "username": nodesAdminUsername,
            "password": nodesAdminPassword,
            "port": node.portInternal || node.port, //TODO: verify if this refers to bind_address (coordinator node?) or remote_node? Assuming bind_address here for now.
            "node_count": String(couchdbNodes.length),
            "remote_node": node.hostInternal || node.host,
            "remote_current_user": nodesAdminUsername,
            "remote_current_password": nodesAdminPassword
          })
          .expect('Content-Type', /json/)
          .expect((res) => {
            debug("Response status=", res.status);
            debug("Response body=", res.body);
            t.equal(res.status, 201, 'Request status: accepted');
            t.assert(res.body, "Response has a body");
            t.false(res.body.reason, "No error/reason in response");
            t.assert(res.body.ok, "Node returned an ok");
          })
          .end(t.end);
      });

      t.test(`Adding node ${node.host}: add_node call via coordinatorNode=${coordinatorNode.host}`, (t) => {
        request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${coordinatorNode.host}:${coordinatorNode.port}`)
          .post('/_cluster_setup')
          .send({
            "action": "add_node",
            "host": node.hostInternal || node.host,
            "port": node.portInternal || node.port,
            "username": nodesAdminUsername,
            "password": nodesAdminPassword
          })
          .expect('Content-Type', /json/)
          .expect((res) => {
            debug("Response status=", res.status);
            debug("Response body=", res.body);
            t.equal(res.status, 201, 'Request status: accepted (Note: If this causes an error, perhaps cluster is already populated?)');
            //TODO: allow 409 here? happens when cluster is already up? if going to allow this, need to check for anything else?
            t.assert(res.body, "Response has a body");
            t.false(res.body.reason, "No error/reason in response");
            t.assert(res.body.ok, "Node returned an ok");
          })
          .end(t.end);
      });

    });

    t.test('Finish up by calling enable_cluster on the coodinator node', (t) => {
      request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${coordinatorNode.host}:${coordinatorNode.port}`)
        .post('/_cluster_setup')
        .send({
          "action": "finish_cluster"
        })
        .expect('Content-Type', /json/)
        .expect((res) => {
          debug("Response status=", res.status);
          debug("Response body=", res.body);
          t.equal(res.status, 201, 'Request status: accepted');
          t.assert(res.body, "Response has a body");
          t.false(res.body.reason, "No error/reason in response");
          t.assert(res.body.ok, "Node returned an ok");
        })
        .end(t.end);
    });

    t.end();
  });

  t.test('Ensure all nodes have formed a cluster by asseting their _cluster_setup state is cluster_finished', (t) => {
    couchdbNodes.forEach((node) => {
      t.test(`Check cluster state of node ${node.host}`, (t) => {
        request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${node.host}:${node.port}`)
          .get('/_cluster_setup')
          .expect(200)
          .expect('Content-Type', /json/)
          .expect((res) => {
            t.assert(res.body, "Response has a body");
            t.equal(res.body.state, 'cluster_finished', "Node is in cluster_finished state");
          })
          .end(t.end);
      });
    });
    t.end();
  });

  t.test("Check if cluster has been set up by calling _membership on first node, asserting the correct number of nodes in it's list", (t) => {
    const node = couchdbNodes[0];
    request(`http://${nodesAdminUsername}:${nodesAdminPassword}@${node.host}:${node.port}`)
      .get('/_membership')
      .expect('Content-Type', /json/)
      .expect((res) => {
        debug("Response status=", res.status);
        debug("Response body=", res.body);
        t.equal(200, res.status, 'Request status: ok');
        t.assert(res.body, "Response has a body");
        t.assert(res.body.all_nodes, "Response has an all_nodes property");
        t.assert(res.body.cluster_nodes, "Response has a cluster_nodes property");
        t.equal(res.body.all_nodes.length, couchdbNodes.length, "Number of known nodes is equal to the wanted/required number of nodes in the cluster");
        t.equal(res.body.cluster_nodes.length, res.body.all_nodes.length, "Number of nodes in the cluster is equal to the number of known nodes");
      })
      .end(t.end);
  });

  t.end();
});
