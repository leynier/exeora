# GrokBot Cursor

GrokBot Cursor is Exeora's independent Cursor-format distribution, with `.cursor-plugin/plugin.json`, root `mcp.json`, the Exeora logo and three adapted skills. Its identifier is `grokbot-cursor`; its visible name is exactly **GrokBot Cursor**. It connects to the fixed remote Exeora endpoint without packaged credentials.

## Cursor local import

1. Download `grokbot-cursor-plugin.zip` from https://exeora.dev/docs/grokbot-cursor/ and verify its SHA-256 sidecar.
2. Extract the contents into a new `~/.cursor/plugins/local/grokbot-cursor` folder. Include the hidden `.cursor-plugin` directory; its `plugin.json` must be directly under that directory, without an extra enclosing archive folder. Copy files rather than linking to a repository outside the local plugin directory.
3. Restart Cursor or run **Developer: Reload Window**, then open **Customize** and check that the three skills and Exeora MCP appear. Local imports must already be allowed by your organization's policy; do not change that policy to bypass a restriction. An installed marketplace package with the same identifier takes precedence.
4. Complete the client's Exeora connection/OAuth flow and ask it to list your authorized projects. Package discovery is not proof that authorization succeeded.

## Cursor repository distribution

The repository-root `.cursor-plugin/marketplace.json` points to `plugins/exeora-cursor`. Teams/Enterprise can use **Dashboard > Plugins & MCPs > Team Marketplaces > Add Marketplace > Import from Repo** with `https://github.com/leynier/exeora`, subject to their existing policy. Users find approved entries in **Customize**, select **Install** and choose a project/user scope. Public marketplace publication requires Cursor's separate review at https://cursor.com/marketplace/publish and has not been performed here.

## Grok Bot

The official Grok Bot guide documents **Plugins > browse/search > add > Authorize or Authenticate > Installed**, and **Reopen** when waiting for authorization. Follow that flow only if this provider is actually listed for your account/team. If it is absent, do not claim it was installed or substitute another provider.

The guide does not document uploading custom ZIPs, loading `.cursor-plugin` folders or importing arbitrary repository plugins into Grok Bot. Sharing an account or Cursor team does not prove that a Cursor plugin, its skills or MCP are available to a Bot. This ZIP is prepared in the documented Cursor format; Grok Bot catalog ingestion and skill loading remain unverified. No Grok Bot upload button or OAuth callback is invented.

## OAuth, assets and verification

`mcp.json` contains only the public HTTPS URL. Cursor documents dynamic registration and optional static `auth` credentials; no static client credentials, headers or variables are needed in this distribution. Public Exeora authorization metadata advertises dynamic registration and PKCE. That read-only evidence does not prove a real Cursor or Grok Bot OAuth exchange. Provider grants, credentials and persistent permissions are unchanged.

The logo is Exeora's brand asset, referenced by the documented relative `logo` field. `displayName` follows Cursor's official plugin template; the reference field table currently omits it. Rendering remains host-controlled. No Cursor/Grok branding implies publication or endorsement.

Tests cover deterministic ZIP bytes, manifest/skill checks, download responses and preserved distributions. They do not install into either host, publish a marketplace entry or authenticate a real account.

Sources: https://cursor.com/docs/reference/plugins ; https://cursor.com/docs/plugins ; https://cursor.com/docs/mcp ; https://cursor.com/help/grok-bot/connect-plugins ; https://github.com/cursor/plugin-template
