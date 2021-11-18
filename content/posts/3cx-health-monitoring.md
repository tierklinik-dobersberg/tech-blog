---
title: "3CX Health Monitoring"
date: 2021-11-18T14:04:52+01:00
draft: false
tags: [ nomad, 3cx, monitoring ]
---

Automated health monitoring and alerting of our 3CX based phone system using Healthckecks.io, Nomad and a bit of scripting.

<!--more-->

The phone system at our clinic is baked by a cloud-hosted 3CX appliance. 3CX is a Private Branch Exchange (PBX) for Voice-Over-IP (VoIP) that supports advanced call routing and application flows either using built-in features or by using custom "call flows" (written in C# or using their 3CX-Callflow Designer GUI). While we're very happy with 3CX as it fulfills our requirements - with a bunch of custom call-flows -  I was missing some kind of health-monitoring and alerting in case of unexpected situations like our SIP trunk being unavailable. 

Thankfully I stumbled across [lexluga's 3cx-api](https://github.com/lexluga/3cx-api) repository on Github and decided to set up some basic system monitoring on my own. Since we already have a self-hosted version of [Healthchecks.io](//healthchecks.io) running in our cloud it's obvious to re-use it for monitoring and alerting on the availability of 3CX as well.

Healthchecks.io does not perform active availability checks on it's own. Instead, it configures a "ping" URL that should be called on a regular interval by your application/backup scripts or whatever you want to monitor. If those regular pings are late or don't even arrive at all then the system counts the check as failed and send a notification through the configured notifiers (in our case, Matrix push notifications and SMS via Twilio). 

So, first let's create a small program that periodically calls the system-status API of 3CX, performs a few health-checks on the response and eventually reports success or failure to our Healthchecks.io instance. Below is only a small excerpt of the complete source code. You can always head over to [our Github repository](https://github.com/tierklinik-dobersberg/3cx-health-check) to see the full code.

```typescript
async function checkStatus(http: IHttpClient, cfg: Config) {
    const dash = new DashboardClient(http);

    const systemStatus = await dash.getSystemStatus();
    console.log(systemStatus)

    if (!systemStatus.Activated) {
        throw "System is not activated"
    }

    if (cfg.pbxMinExtensions !== undefined) {
        if (systemStatus.ExtensionsRegistered < cfg.pbxMinExtensions) {
            throw `Expected at least ${cfg.pbxMinExtensions} extensions to be registered. Found ${systemStatus.ExtensionsRegistered}`;
        }
    }

    if (systemStatus.HasNotRunningServices) {
        throw `System reports failed services`
    }

    if (systemStatus.HasUnregisteredSystemExtensions) {
        throw `System reports unregistered system extension`
    }

    if(cfg.pbxMinTrunks !== undefined) {
        if (systemStatus.TrunksRegistered < cfg.pbxMinTrunks) {
            throw `Expected at least ${cfg.pbxMinTrunks} trunks to be registered. Found ${systemStatus.TrunksRegistered}`;
        }
    }

    if(systemStatus.PhysicalMemoryUsage > 75) {
        throw `Physical memory usage is at ${systemStatus.PhysicalMemoryUsage}`
    }

    if(systemStatus.CpuUsage > 75) {
        throw `CPU usage is at ${systemStatus.CpuUsage}`
    }

    if(systemStatus.DiskUsage > 75) {
        throw `Disk usage is at ${systemStatus.CpuUsage}`
    }
}

async function reportFailure(cfg: Config, error: any) {
    console.log(`[FAIL] Reporting 3CX failure`)
    if (typeof error === 'object' && 'toString' in error) {
        error = error.toString()
    }

    await axios.default.post(`${cfg.HealthCheckServer}/ping/${cfg.HealthCheckUID}/fail`, error)
}

async function reportSuccess(cfg: Config) {
    console.log(`[ OK ] 3CX PBX is healthy, reporting ...`)
    await axios.default.get(`${cfg.HealthCheckServer}/ping/${cfg.HealthCheckUID}`)
}

async function main() {
    console.log("[INFO] starting 3cx health check...")

    const cfg = loadConfig()
    const http = await createClient(cfg.pbxHost, {Username: cfg.pbxUser, Password: cfg.pbxPassword});
    
    while(true) {
        await checkStatus(http, cfg)
            .then(() => reportSuccess(cfg))
            .catch((e: any) => reportFailure(cfg, e))

        if (cfg.Interval !== null) {
            await sleep(cfg.Interval)
        } else {
            break
        }
    }
}
```

As I plan to run those checks on our [Nomad cluster](/tags/nomad/) I decided to configure the check script only using environment variables. Though, before I can deploy it to our cluster I need to create a OCI container image and push that to our docker registry. Below is an excerpt of the Dockerfile that I use to build a rather small (~30MB) container image:

```dockerfile
FROM mhart/alpine-node:16
WORKDIR /app
COPY . /app

RUN npm install
RUN npm run build
RUN rm -rf node_modules
RUN npm install --omit dev

FROM mhart/alpine-node:slim-16

WORKDIR /app
COPY --from=0 /app/dist .
COPY --from=0 /app/node_modules ./node_modules
COPY . .
CMD ["node", "main.js"]
```

Finally, I needed to create a small Nomad jobspec file that runs the check and reads username and password for 3CX from Vault:

```hcl
job "3cx-check" {
    datacenters = [ "dc1" ]
    type = "service"

    group "check" {
        task "check" {
            vault {
                policies = ["3cx"]
            }
            
            driver = "docker"
            config {
                image = "registry.service.consul:5000/3cx-check:latest"
            }

            resources {
                cpu = 10
                memory = 20
            }
            
            env {
                HC_SERVER = "https://healtchecks.io"
                HC_PING_UID = "<YOUR-PING-UID>"
                PBX_MIN_EXTENSIONS = "10"
                PBX_MIN_TRUNKS = "2"
                INTERVAL_SEC = "300"
            }

            template {
                destination = "secrets/env"
                env = true
                data = <<EOF
{{ with secret "secret/data/3cx/config" }}
PBX_HOST="{{ .Data.data.host }}"
PBX_PASSWORD="{{ .Data.data.password }}"
PBX_USER="{{ .Data.data.user }}"
{{ end }}
EOF
            }

        }
    }
}
```

I would normally use [periodic "batch" jobs](https://www.nomadproject.io/docs/job-specification/periodic) for that kind of workload but I'm planning to expose the CPU, Memory, Disk usage and some other 3CX metrics for our Prometheus/Grafana stack in the future so I'm running the above as a `type = "service"`.

That's it for now. Whenever the 3CX goes offline, has high CPU or memory usage or does not have at least 10 extensions registered I will get notified thourgh Matrix and SMS (via Healtchecks.io). 🎉
