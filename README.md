<h1 align="center">
<br>
<img src="https://raw.githubusercontent.com/Cenvora/ha-veeam-br/main/custom_components/veeam_br/brand/logo.png"
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

### HACS (recommended)

Have [HACS](https://hacs.xyz/) installed, then use this button:

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Cenvora&repository=ha-veeam-br-dashboard&category=plugin)

Click **Download**, then reload your browser.

> [!NOTE]
> This is not in the default HACS store yet. If the button above doesn't work, add
> `https://github.com/Cenvora/ha-veeam-br-dashboard` as a custom repository of type
> **Dashboard** in HACS → ⋮ → **Custom repositories**, then download it from there.
>
> The type is called **Dashboard** in the HACS interface but `plugin` everywhere machine
> readable — the install button above, `hacs.json`, and the CI workflow all use `plugin`.
> HACS maps the two (`common.type.plugin` = "Dashboard"); they are not different categories.

HACS registers the dashboard resource for you, so there is nothing to add by hand.

<details><summary>Manual install</summary>

1. Copy `veeam-br-dashboard.js` from the
   [latest release](https://github.com/Cenvora/ha-veeam-br-dashboard/releases/latest) into
   `<config>/www/`
2. Add it under **Settings → Dashboards → ⋮ → Resources** as `/local/veeam-br-dashboard.js`,
   type **JavaScript module**
3. Reload your browser

</details>

## Usage

### A whole dashboard

**Settings → Dashboards → Add dashboard → New dashboard from scratch**, then ⋮ → **Raw
configuration editor**, and replace the contents with:

```yaml
strategy:
  type: custom:veeam-br
```

That's the entire configuration. You get up to five views:

| View | Contents |
| ---- | -------- |
| **Overview** | A live headline, server/cluster/security/licence badges, and one tile per job, repository, proxy and accelerator |
| **Jobs** | A section per backup job with its sensors, its target, and start/stop/retry buttons |
| **Repositories** | A section per repository and scale-out repository, with used space as a gauge |
| **Security** | A section per server: malware detection, the Security & Compliance Analyzer, and a button to run it |
| **Infrastructure** | HA cluster, backup proxies, WAN accelerators, server details and licensing |

Views with nothing to show are left out, so a server with no scale-out repositories does not
get an empty tab — and a server without the Security device (an older API version, or an
account without the role to read it) gets no Security tab.

### Security

Integration 0.8.0 adds a **Security** device per server. Its section on the Security view reads
top to bottom:

```
Security vbr01
┌──────────────────────────────────────────────────────────┐
│ ⚠ Malware detected — 2 infected and 1 suspicious object, │  only while Malware Detected is on
│   most recently fileserver01, sql02.                     │
├──────────────────────────────────────────────────────────┤
│ ⚠ Best practices not followed — MFA, Immutability        │  only while Best Practices is on
└──────────────────────────────────────────────────────────┘
[Malware Detected: OK]         [Best Practices: Problem]
[Infected Objects: 0]          [Suspicious Objects: 0]
[Best Practice Violations: 2]  [Malware Events (24h): 0]
[Last Malware Event: 3 days ago]  [Last Analyzer Run: 2 hours ago]
[Run Security Analyzer]
```

- **Malware Detected** and **Best Practices** are problem sensors, so their tiles read *Problem*
  or *OK* and Home Assistant colours them live. While either is on, a banner above the tiles says
  what is wrong, from the sensor's own attributes: the infected and suspicious counts and the
  most recently detected objects, or the best practices violated.
- The two are also **badges** on the overview, beside the server's, and the **headline** raises
  malware as an error and violations as a warning — *on 1 of 2 servers* when you have several.
  With nothing wrong it reads *No malware detected, and no best practice violations.*
- Before API `1.3-rev2` the integration has no detected-object entities, so there is no Malware
  Detected: the section shows what exists, Best Practices takes its place on the overview, and
  the headline says nothing about malware rather than claiming there is none.
- None of these are diagnostic entities, so `include_diagnostics` does not affect them.

### Server and jobs

- The server's section on the Infrastructure view shows **Move/Copy Sessions Awaiting Action**
  and **Recovery Appliances Connected** after Connected and Health OK. While any move or copy is
  waiting for a decision, a banner at the top lists the sessions and points at the
  `veeam_br.manage_move_copy_session` action, and the overview headline mentions it.
- Every job's section shows its **Target** — where it writes to — after Status and Last Result.
  The integration files Target under diagnostics; it is shown regardless, like the server's
  Connected and Health OK, but never takes the job's place on the overview.

### A single view in an existing dashboard

Two editors take two different shapes, and pasting one into the other is the usual cause of an
empty view.

**Dashboard ⋮ → Raw configuration editor** — the whole dashboard, so views are a list:

```yaml
views:
  - strategy:
      type: custom:veeam-br
      group: jobs
      title: Backups
      icon: mdi:shield-check
      theme: midnight
  - title: Something else of your own
    cards: []
```

**A single view → Edit view → ⋮ → Edit in YAML** — one view, so there is no `views:` key and no
`type:`/`sections:` of your own:

```yaml
strategy:
  type: custom:veeam-br
  group: jobs
  title: Backups
  icon: mdi:shield-check
  theme: midnight
```

`group` accepts `overview`, `jobs`, `repositories`, `security` or `infrastructure`.

> [!IMPORTANT]
> Set the view's **name, icon and theme inside the `strategy:` block**, as above — not beside it,
> and not in the visual editor.
>
> Home Assistant applies a strategy's generated configuration *over* the view's own keys, so a
> `title:` next to `strategy:` is ignored and the tab reads *Unnamed view*. And using the visual
> editor to rename or restyle the view replaces the strategy with a static copy of the cards it
> happened to generate that moment — the dashboard stops updating itself. That is how strategies
> work in Home Assistant generally, not something specific to this one.
>
> `title`, `path`, `icon`, `theme`, `background`, `subview` and `visible` are accepted directly.
> Anything else Home Assistant supports on a view goes under `view:`, which is passed through
> untouched:
>
> ```yaml
> strategy:
>   type: custom:veeam-br
>   view:
>     theme: midnight
>     top_margin: true
> ```

### Options

All optional, and valid on either the dashboard or a view strategy:

| Option | Default | What it does |
| ------ | ------- | ------------ |
| `title`, `icon`, `path` | per view | Name a generated view. The whole-dashboard strategy names its own views, so it ignores these |
| `theme`, `background`, `subview`, `visible` | — | Standard view settings. On the dashboard strategy they apply to every view |
| `view` | — | Any other view setting, passed through verbatim |
| `summary` | `true` | The live headline counting failed jobs and full repositories, and raising malware, best practice violations and move/copy sessions awaiting action |
| `badges` | `true` | Show server, cluster, security and licence state as badges instead of tiles |
| `columns` | `3` | Maximum section columns |
| `include_diagnostics` | `false` | Include diagnostic entities — build numbers, IDs, timelines. The server's Connected and Health OK and a job's Target are shown either way |
| `include_config` | `true` | Include config entities. The job start/stop buttons live here |
| `include_hidden` | `false` | Include entities you have hidden |
| `repository_warn_at` | `85` | Used-space percentage treated as a warning, in the headline and on the gauges |

```yaml
strategy:
  type: custom:veeam-br
  include_diagnostics: true
  repository_warn_at: 75
  columns: 2
```

### Multiple Veeam servers

Each server is its own config entry, and all of them are picked up. When more than one is
configured, section titles are suffixed with the server name — so two jobs both called
`Nightly VMs` on different servers stay distinguishable. A device already named after its
server, such as *Security vbr01* or *License vbr01*, is not suffixed again. Each server gets its
own Security section and badges, and the headline counts across all of them.

## How it works

The strategy asks Home Assistant for the device and entity registries, keeps entities whose
platform is `veeam_br`, and groups their devices by model — `Backup Job`,
`Backup Repository`, `Scale-Out Backup Repository`, `Backup Proxy`, `WAN Accelerator`,
`Backup & Replication Server`, `License`, `High Availability Cluster`, `Security`.

Working from the registry rather than matching entity IDs means renaming an entity or a device
does not break the dashboard, and disabled entities are never given a tile that would render
broken.

### Device names and entity IDs

The integration names its devices `VBR <kind> <name>` — *VBR Job Nightly VMs*, *VBR Server
vbr01*, *VBR Default Backup Repository* (the kind is left out when the name already has it).
Section and tile titles drop that lead-in, so under *Backup jobs* you read *Nightly VMs*. A
license, an HA cluster and the Security device keep their kind (*License vbr01*, *Security
vbr01*), since they are named after the server, and a name you give a device yourself is shown exactly as you wrote it.

Within a device, the strategy recognises an entity by the end of its ID or by its own name, so
both ID schemes work:

| Install | Example |
| ------- | ------- |
| Set up before device names were prefixed | `sensor.nightly_vms_last_result` |
| Set up since | `sensor.vbr_job_nightly_vms_last_result` |

Home Assistant keeps an existing entity's ID when its device is renamed, so upgrading the
integration changes nothing here. A `_2` or `_3` that Home Assistant appended to resolve a
clash — with the Veeam Backup for Microsoft 365 integration, say — is ignored too.

A few deliberate choices in the layout:

- **One tile per device on the overview**, named for the device — a proxy contributing three
  tiles that all read *veeam-worker-01* tells you nothing about which is which. The rest of a
  device's entities are on its own section in the Jobs, Repositories, Security or
  Infrastructure view.
- **Short names inside a device section.** In a section already titled *Nightly VMs*, the tiles
  read *Status*, *Last Result*, *Start* — not the full friendly name repeated four times.
- **Jobs lead with Last Result, not Status.** Status reports what a job is doing (`Running`,
  `Inactive`, `Disabled`) and never reports failure; the pass/fail outcome of the last run is on
  Last Result.
- **Used space is a gauge**, coloured at `repository_warn_at`. A tile reading *0.2%* is a number
  you have to think about; a gauge is not.
- **Server, cluster, security and licence state are badges**, because they are one-per-server
  facts that belong along the top rather than in a section competing with your jobs. The server's
  *Connected* and *Health OK* are shown even with `include_diagnostics` off, although the
  integration files them as diagnostics — otherwise the server would not appear at all.
- **Failing endpoints are spelled out.** While *Health OK* is off, the server's section lists
  the endpoints that failed, from its `failed_endpoints` attribute. An entity whose endpoint
  failed goes unavailable rather than showing stale data, and the headline counts unavailable
  jobs and repositories instead of calling them healthy.
- **The headline is a template**, not a count baked in at render time. A strategy runs once per
  page load, so anything computed from live states would be a stale snapshot minutes later —
  that also applies to card order and colour, which is why neither depends on state. The
  banners for malware, best practices, failing endpoints and waiting move/copy sessions are
  there all along and shown or hidden by Home Assistant's own visibility conditions.

## Development

Plain ES module, no build step, no dependencies. The file you edit is the file Home Assistant
loads.

```bash
node --test        # or: npm test
```

The tests import the module directly and feed it registry fixtures, asserting on the generated
dashboard configuration — grouping, filtering, multi-server labelling, both entity ID schemes,
the Security view with and without the Security device, and the empty state.

## Related

- [ha-veeam-br](https://github.com/Cenvora/ha-veeam-br) — the integration that produces the
  entities, including automation blueprints
- [veeam-br](https://github.com/Cenvora/veeam-br) — the Python REST API library underneath

## License

MIT — see [LICENSE](LICENSE).
