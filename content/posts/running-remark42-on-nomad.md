---
title: "Privacy focused Remark42 commenting engine on Nomad"
date: 2021-11-02T15:53:17+01:00
draft: true
tags: [nomad, vault, hugo]
---

In this post we'll show you how to run the privacy focused [Remark42](https://remark42.com/) commenting engine on a
Hashicorp Nomad cluster and integrate it into a static website built by [Hugo](/tags/hugo/). We'll enable email and
social logins using Github and manage those credentials using Vault. The setup described here is similar to the
setup used for this website.

<!--more-->

## Introduction

To state the website, Remark42 is a 

> Privacy focused lightweight commenting engine

with a bunch of features that supports easy self-hosting and integration into websites like blogs. Remark42 does not
do any user tracking and only stores the minimum required information about users. Authentication/Authorization is
either done using email or using third-party OAuth identity providers like Github, Google, Facebook and the like. Check
their [website](https://remark42.com/docs/configuration/authorization/) for a complete list of supported identity
providers. 

Since I was searching for a simple commenting engine that can be embedded on `tech.dobersberg.vet` (and at some point
maybe on `tierklinikdobersberg.at` as well) I immediately decided to give Remark42 a try when I first stumbled accross
it. Self-hosting and privacy-by-design are rather important aspects [to me](/about-author/) so this seems like a good
fit. It will also allow me to keep our [Privacy Statement](/about/#privacy-statement) short.

Only first-party cookies and no tracking - sounds good 🙃.

## Prerequisite

This post assumes that you already have a Nomad cluster with Vault integration up and running. If not, keep 
patient and wait for our Nomad cluster blog series or just dive into the [documentation](//nomadproject.io)
on your own.

## Preparing the Nomad Job

In order to run something on our Nomad cluster we must create a [Jobspec file](https://www.nomadproject.io/docs/job-specification)
first. This job file contains all the information Nomad needs to schedule and run the workload somewhere in the cluster. 
It contains information about the kind of workload and the tasks to execute, required volumes, constraints on allowed cluster nodes and
required/expected CPU and memory resources. 

Though, before we can start writing the jobspec we need to find out which environment Remark42 expects to find when executed.

Since Remark42 stores all comments in a local [BoltDB](https://github.com/etcd-io/bbolt) file we need to provide some kind
of persistent storage to the job - that's called a [stateful workload](https://learn.hashicorp.com/collections/nomad/stateful-workloads).

In our Nomad cluster almost all cluster members participate in a distributed and replicated [GlusterFS](https://www.gluster.org/) volume.
This volume is mounted on each cluster member and made available to Nomad as a [host volume](https://www.nomadproject.io/docs/configuration/client#host_volume-stanza) at `/data/shared/`. We will use this volume for our Remark42 deployment and Nomad will automatically figure out which cluster members are eligible for this job.

In addition, Remark42 exposes a HTTP API that we want to serve **securely** on `remark42.dobersberg.vet`. That's the job of our
Traefik ingress deployment. It automatically monitors services announced via Nomad and [Consul](//consul.io) and configures/requests SSL certificates from Let's Encrypt depending on a service' labels. However, digging into this is something for another post.

### The Remark42 Jobspec


### Initialize Storage
## Authentication

### E-Mail Login
### Social Login: Github OAuth Credentials

### Vault Policy and Secrets

## Hugo Site Integration

### Optional Comments
