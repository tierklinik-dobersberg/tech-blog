---
title: "Privacy focused Remark42 commenting engine on Nomad"
date: 2021-11-02T15:53:17+01:00
draft: false
allow_comments: yes
tags: [nomad, hugo, linux]
---

In this post we'll show you how to run the privacy focused [Remark42](https://remark42.com/) commenting engine on a
Hashicorp Nomad cluster and integrate it into a static website built by [Hugo](/tags/hugo/). During that, we'll discuss the Nomad
job file in detail. The setup described here is similar to the setup used for this blog.

<!--more-->

## Introduction

To state the website, Remark42 is a 

> Privacy focused lightweight commenting engine

with a bunch of features that supports easy self-hosting and integration into websites and blogs. Remark42 does not
do any user tracking and only stores the minimum required information about visitors. Authentication/Authorization is
either done using E-Mail or by integrating third-party OAuth identity providers like Github, Google, Facebook and the
like. Check their [website](https://remark42.com/docs/configuration/authorization/) for a complete list of supported identity
providers. 

Since I was searching for a simple commenting engine that can be embedded on `tech.dobersberg.vet` (and at some point
maybe on `tierklinikdobersberg.at` as well) I immediately decided to give Remark42 a try when I first stumbled across
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

Though, before we can start writing the jobspec we need to find out which environment Remark42 requires when executed.

Since Remark42 stores all comments in a local [BoltDB](https://github.com/etcd-io/bbolt) file we need to provide some kind
of persistent storage to the job - that's called a [stateful workload](https://learn.hashicorp.com/collections/nomad/stateful-workloads).

In our Nomad cluster almost all cluster members participate in a distributed and replicated [GlusterFS](https://www.gluster.org/) volume.
This volume is mounted on each cluster member and made available to Nomad as a [host volume](https://www.nomadproject.io/docs/configuration/client#host_volume-stanza)
using the name `shared-data`. We will use this volume for our Remark42 deployment and Nomad will automatically figure out which cluster members are eligible for this job.

In addition, Remark42 exposes a HTTP API that we want to serve **securely** on `remark42.dobersberg.vet`. That's the job of our
Traefik ingress deployment. It automatically monitors services announced via Nomad and [Consul](//consul.io) and configures/requests SSL certificates from Let's Encrypt depending on the service's labels. However, digging into this is something for another post.

### The Remark42 Jobspec

Without much words, here's the initial jobspec that we will start with:

```hcl
job "remark42" {
    datacenters = ["dc1"]
    type        = "service"

    group "remark" {
        volume "db" {
            type      = "host"
            source    = "shared-data"
            read_only = false
        }

        network {
            port "http" {
                to = 8080
            }
        }

        service {
            name = "remark42"
            port = "http"
            tags = [
                "traefik.enable=true",
                "traefik.http.routers.remark42.entrypoints=https",
                "traefik.http.routers.remark42.rule=Host(`remark42.dobersberg.vet`)",
                "traefik.http.routers.remark42.tls=true",
                "traefik.http.routers.remark42.tls.certResolver=letsencrypt"
            ]
            check {
                name     = "alive"
                type     = "tcp"
                port     = "http"
                interval = "10s"
                timeout  = "2s"
            }
        }

        task "server" {
            driver = "docker"

            config {
                image = "umputun/remark42:latest"
                entrypoint = ["/bin/sh"]
                command = "/custom-init.sh"
                ports = ["http"]
                volumes = ["local/custom-init.sh:/custom-init.sh:ro"]
            }

            template {
                destination = "local/custom-init.sh"
                data = <<EOF
#!/bin/bash
set -e
ln -s /data/remark42 /srv/var 
/init.sh /srv/remark42 server
EOF
            }

            volume_mount {
                volume = "db"
                destination = "/data"
            }

            env {
                REMARK_URL = "https://remark42.dobersberg.vet/"
                STORE_BOLT_PATH = "/srv/data/remark42/db"
                BACKUP_PATH = "/srv/data/remark42/backup"
            }

            template {
                destination = "secrets/env"
                env = true
                data = <<EOF
SECRET="some-random-secret"
EOF
            }
        }
    }
}
```

That's a lot so let's discuss and explain the jobspec section by section.

```hcl
    datacenters = ["dc1"]
    type        = "service"
```

Those configuration stanzas just tell Nomad that this job is meant to be executed in our datacenter "dc1".
That's the name of the default datacenter of a Nomad cluster unless you configured it otherwise. It also
informs Nomad that we want to run our Remark job as a service. That means that nomad will schedule the configured
amount (here just one) of job instances across eligible nodes in the cluster. There are also other job types
like system and batch available. For more information on them please refer to the [Scheduler Documentation](https://www.nomadproject.io/docs/schedulers).

```hcl
group "remark" {
    # ...
}
```

A Nomad job can have multiple groups with each group being composed of one or more tasks and services. For this post
we just need a single group. 

```hcl
volume "db" {
    type      = "host"
    source    = "shared-data"
    read_only = false
}
```

This block tells Nomad that our job group needs a volume that we call `db` in the jobspec. That name is only for
references in other configuration blocks and directives of our job file. We also tell Nomad that we
want to use the [host-volume (`type = "host"`)](https://www.nomadproject.io/docs/configuration/client#host_volume-stanza) named
`shared-data`. 

Since host volumes are configured on a Nomad client basis, all Nomad servers automatically know which cluster clients are
eligible to run the Remark job. 


```hcl
network {
    port "http" {
        to = 8080
    }
}
```

Next up, we tell Nomad that we want to have a TCP/UDP port on the cluster client that is forwarded to port `8080`. The `network` stanza itself does not tell Nomad how or where to forward traffic to. That's up to the workload/task driver (in our case `docker`, see below). Using this configuration block, Nomad will pick a random high port and tell the task driver that it should forward that port to `8080`.
Like with volumes, Nomad supports working with named ports. In our case, we named the port definition `http`. The rest of the jobspec
file will just refer to that port using it's name. Note that while the name does not need to specify what the port is used for, it's common practice to name to port after it's purpose.

You can find more information about the network stanza [here](https://www.nomadproject.io/docs/job-specification/network).

At this point we told Nomad about the job type and across which datacenters it should be spread. We also decided to store any state
and persistent information in a host volume called `shared-data` and that we want to have a network port named `http` forwarded to port 8080.

The next block in our jobspec describes a `service` but for that we need to talk about [Consul](//consul.io) first.

Consul is, like Nomad and Vault, a product of Hashicorp. It provides a generic Key-Value store, Service Discovery using DNS-SD including
health monitoring and much more. If you have a Nomad cluster at hand chances are good you already have Consul integration set-up.

So let's talk about the following block:

```hcl
service {
    name = "remark42"
    port = "http"
    tags = [
        "traefik.enable=true",
        "traefik.http.routers.remark42.entrypoints=https",
        "traefik.http.routers.remark42.rule=Host(`remark42.dobersberg.vet`)",
        "traefik.http.routers.remark42.tls=true",
        "traefik.http.routers.remark42.tls.certResolver=letsencrypt"
    ]
    check {
        name     = "alive"
        type     = "tcp"
        port     = "http"
        interval = "10s"
        timeout  = "2s"
    }
}
```

When integrated with Consul, the service block creates a new entry in Consul that is made available using service discovery.
In our case the name of the service is `remark42` and using `port="http"` Nomad can also tell Consul which random high-port it chose for
the service. Next we define a set of tags that are stored along the service in Consul. In our case we have a Traefik ingress job
running that monitors services in Consul and auto-configures HTTPS routes for them. More about that in another post.

Finally, since Consul needs to check if the service is actually healthy we define a simple health check that sends a TCP probe to the `http` port every 10s. If the service becomes unhealthy Consul will no longer advertise it and Traefik will automatically revoke the ingress route. If we would have more than one instance of Remark running than Traefik would exclude the unhealthy instance from receiving any traffic and load balance requests across the healthy ones. 

```hcl
task "server" {
    driver = "docker"

    config {
        image = "umputun/remark42:latest"
        entrypoint = ["/bin/sh"]
        command = "/custom-init.sh"
        ports = ["http"]
        volumes = ["local/custom-init.sh:/custom-init.sh:ro"]
    }

    volume_mount {
        volume = "db"
        destination = "/data"
    }

    template {
        destination = "local/custom-init.sh"
        data = <<EOF
#!/bin/bash
set -e
ln -s /data/remark42 /srv/var 
/init.sh /srv/remark42 server
EOF
    }
    env {
        REMARK_URL = "https://<your-url>/"
        STORE_BOLT_PATH = "/srv/data/db"
        BACKUP_PATH = "/srv/data/backup"
        # ...
    }

    template {
        destination = "secrets/env"
        env = true
        data = <<EOF
SECRET="some-random-secret"
EOF
    }
}
```

This block already describes the actual task that runs the Remark42 server. In our case, there's a docker container image (`umputu/remark42`) available so we are going to use this image using Nomad's docker driver and that we want to expose the named port `http`. We also tell our cluster that this task needs the volume named `db` (see above) to be mounted at `/data` inside the container. Unfortunately the entrypoint script of the docker image does not support placing the Bolt database and backups to a location other than `/srv/data`. This is not a problem on it's own but since we want to persist the database in a subfolder of our host-volume (`/data/remark42`) we need to somehow mount that folder as `/srv/data` inside the container. However, Nomad does not allow mounting a sub-folder of a host volume. To achieve that, we create a custom entrypoint script that creates a symlink to our sub-folder and eventually executes the original entrypoint script. 

Using the `env` block we define a set of environment variables that are required for Remark to run. Those are taken from the example [docker-compose.yml](https://github.com/umputun/remark42/blob/master/docker-compose.yml) file. The `template` block at the end has the same effect as the `env` block but writes the environment variables to a file under `secrets/env` first. We use a `template` block for `SECRET` instead because we want to integrate with [Vault](//vaultproject.io) later.

In theory, that's all we need for our Remark42 job. Make sure the folders `remark42/db` and `remark42/backup` actually exist in your host-volume and you're ready to `nomad job run ./remark42.nomad`.

### Initialize Storage

If you are a bit like me you will also like to avoid manual work as much as possible. I'd like to be able to deploy a copy of my cluster and all
services in a matter of minutes. Since I will likely always forget about manual work-steps I need to ensure the directories `remark42/db` and `remark42/backup` are automatically created on the host-volume whenever I want to create the remark job.

Thankfully Nomad can have multiple tasks per group and also has a concept of life-cycle hooks. The following `task` block creates a small "prestart" task that is run before the actual `remark42` server and just makes sure the directories are set-up. For that, we will use the very small
`busybox` docker image. It would also be possible to use Nomad's `exec` driver but on our cluster all other drivers except `docker` are disabled.

```hcl
task "prepare" {
    lifecycle {
        hook = "prestart"
    }

    driver = "docker"

    config {
        image = "busybox"
        args = [
            "mkdir", "-p",
                "/data/remark42/db",
                "/data/remark42/backup"
        ]
    }

    volume_mount {
        volume = "db"
        destination = "/data"
    }
}
```

Let's re-deploy the jobspec to our Nomad cluster:

```bash
nomad job run ./remark42.nomad
```

After a few minutes the server should be up and running. Depending on how you manage your ingress and HTTP routes you should be able to visit the demo page at `<your-url>/web`

You will probably like to enable some kind of authentication. Though, this is out of scope for this post and configuration of E-Mail or OAuth based authentication is left as an exercise. 

## Hugo Site Integration

Finally, we need to integrate Remark42 into our static [Hugo site](/posts/hugo-tailwind-postcss). For that, edit the layout file that is used to display your posts. In my case I need to edit `./layouts/_default/single.html` and append the following code snippet at the end of that file:

```html
  <script>
    var remark_config = {
      host: 'https://remark42.dobersberg.vet',
      site_id: 'tech.dobersberg.vet',
      components: ['embed'],
      theme: 'light',
      locale: 'en', 
      show_email_subscription: true,
      simple_view: true,
    };
  </script>
  <script>!function(e,n){for(var o=0;o<e.length;o++){var r=n.createElement("script"),c=".js",d=n.head||n.body;"noModule"in r?(r.type="module",c=".mjs"):r.async=!0,r.defer=!0,r.src=remark_config.host+"/web/"+e[o]+c,d.appendChild(r)}}(remark_config.components||["embed"],document);</script>
```

Finally, we just need to tell remark where the comments should be placed by adding a `div` with `remark42` as an ID:

```html
    <div id="remark42"></div>
```

Congrats, your website/blog now has a privacy focused, self-hosted commenting engine that's running on your Nomad cluster!
