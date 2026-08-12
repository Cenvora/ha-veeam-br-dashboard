<h1 align="center">
<br>
<img src="https://raw.githubusercontent.com/Cenvora/ha-veeam-br/main/media/Veeam_logo_2024_RGB_main_20.png"
     alt="Veeam Logo"
     height="100">
<br>
<br>
Veeam Backup &amp; Replication Dashboard
</h1>

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)

An auto-generating Home Assistant dashboard for the
[Veeam Backup &amp; Replication integration](https://github.com/Cenvora/ha-veeam-br). It reads
the device and entity registries at render time and builds views from whatever the integration
has created — so jobs and repositories appear and disappear on their own, with no dashboard
YAML to maintain.

This project is an independent, open source project. It is not affiliated with, endorsed by, or
sponsored by Veeam Software.

## Requirements

- Home Assistant 2026.1 or newer
- The [ha-veeam-br](https://github.com/Cenvora/ha-veeam-br) integration, set up and producing
  entities

## Installation

### HACS

This is not yet in the default HACS store, so add it as a custom repository:

1. HACS → ⋮ → **Custom repositories**
2. Repository: `https://github.com/Cenvora/ha-veeam-br-dashboard`, Category: **Dashboard**
3. Install, then reload the browser

HACS registers the resource for you. If you installed manually instead, copy
`veeam-br-dashboard.js` into `<config>/www/` and add it under
**Settings → Dashboards → ⋮ → Resources** as `/local/veeam-br-dashboard.js`, type
**JavaScript module**.

## Usage

### A whole dashboard

**Settings → Dashboards → Add dashboard → New dashboard from scratch**, then ⋮ → **Raw
configuration editor**, and replace the contents with:

```yaml
strategy:
  type: custom:veeam-br
```

That's the entire configuration. You get four views:

| View | Contents |
| ---- | -------- |
| **Overview** | A compact tile per job, repository, cluster, server and license |
| **Jobs** | A section per backup job with its sensors and start/stop/retry buttons |
| **Repositories** | A section per repository and scale-out repository |
| **Infrastructure** | HA cluster, server details and licensing |

Views with nothing to show are left out, so a server with no scale-out repositories does not
get an empty tab.

### A single view in an existing dashboard

```yaml
views:
  - title: Backups
    strategy:
      type: custom:veeam-br
      group: jobs
```

`group` accepts `overview`, `jobs`, `repositories` or `infrastructure`.

### Options

All optional, and valid on either the dashboard or a view strategy:

| Option | Default | What it does |
| ------ | ------- | ------------ |
| `include_diagnostics` | `false` | Include diagnostic entities — build numbers, IDs, timelines |
| `include_config` | `true` | Include config entities. The job start/stop buttons live here |
| `include_hidden` | `false` | Include entities you have hidden |
| `repository_warn_at` | `85` | Used-space percentage called out on the overview |

```yaml
strategy:
  type: custom:veeam-br
  include_diagnostics: true
  repository_warn_at: 75
```

### Multiple Veeam servers

Each server is its own config entry, and all of them are picked up. When more than one is
configured, section titles are suffixed with the server name — so two jobs both called
`Nightly VMs` on different servers stay distinguishable.

## How it works

The strategy asks Home Assistant for the device and entity registries, keeps entities whose
platform is `veeam_br`, and groups their devices by model — `Backup Job`,
`Backup Repository`, `Scale-Out Backup Repository`, `Backup & Replication Server`, `License`,
`High Availability Cluster`.

Working from the registry rather than matching entity IDs means renaming an entity or a device
does not break the dashboard, and disabled entities are never given a tile that would render
broken.

On the overview, jobs lead with their **Last Result** sensor rather than **Status**: Status
reports what a job is doing (`Running`, `Inactive`, `Disabled`) and never reports failure — the
pass/fail outcome of the last run is on Last Result.

## Development

Plain ES module, no build step, no dependencies. The file you edit is the file Home Assistant
loads.

```bash
node --test        # or: npm test
```

The tests import the module directly and feed it registry fixtures, asserting on the generated
dashboard configuration — grouping, filtering, multi-server labelling and the empty state.

## Related

- [ha-veeam-br](https://github.com/Cenvora/ha-veeam-br) — the integration that produces the
  entities, including automation blueprints
- [veeam-br](https://github.com/Cenvora/veeam-br) — the Python REST API library underneath

## License

MIT — see [LICENSE](LICENSE).
