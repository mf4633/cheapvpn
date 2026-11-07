# CheapVPN

A Chrome extension that sends browser traffic through an SSH tunnel or proxy server you control. One switch on, one switch off.

CheapVPN isn't a VPN service and comes with no servers. It connects Chrome to a proxy you run or rent.

**Status:** version 1.2.0 is in Chrome Web Store review, so there's no store link yet. You can load it from this repo in the meantime.

Guide and screenshots: https://mf4633.github.io/cheapvpn-site/

## Quick start

1. Open a tunnel to any server you can SSH into, and leave it running:

   ```
   ssh -D 1080 -N you@your-server
   ```

2. Click the CheapVPN icon and open **Add server**. Choose SOCKS5, then enter host `127.0.0.1` and port `1080`.
3. Turn on the switch. The toolbar shows ON, and **Check my IP** should show your server's address.

## Load from source

1. Download this repo.
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repo folder.

There's no build step. The files here are the files in the extension.

## Features

Free:

- SOCKS5, SOCKS4, HTTP and HTTPS proxies
- Several saved servers
- Automatic login for HTTP and HTTPS proxies
- Bypass list
- Check my IP

Pro, $2.99 one-time through ExtensionPay/Stripe:

- Per-site rules, with a different server for each site if you want
- Latency, speed and exit-country test for every server
- One click to switch to the fastest server

## Limits

- It only affects Chrome. Other apps keep using your normal connection.
- Chrome doesn't support SOCKS usernames and passwords, so logins only work with HTTP and HTTPS proxies.
- Whoever runs your proxy can see what your internet provider normally could. Use one you trust.
- Proxy passwords are saved in Chrome's local extension storage and aren't encrypted by CheapVPN.

## What it connects to

There are no analytics or telemetry.

| Service | When | Why |
|---|---|---|
| Your proxy server | While switched on | Carries your traffic |
| extensionpay.com | Automatically | Checks whether you've bought Pro |
| api.ipify.org | When you click Check my IP | Shows your public IP |
| speed.cloudflare.com | When you click Test all (Pro) | Measures each server |

Full details are in the [privacy policy](https://mf4633.github.io/extension-policies/cheapvpn/privacy.html).

## Permissions

| Permission | Why |
|---|---|
| `proxy` | Applies the server you choose |
| `storage` | Saves your servers and settings on your device |
| `webRequest`, `webRequestAuthProvider` | Answers login requests from your proxy |
| `<all_urls>` | A proxy can ask for a login on any request |
| Content script on `extensionpay.com` | Confirms a Pro purchase (ExtensionPay library) |

## License

CheapVPN is licensed under [AGPL-3.0-or-later](LICENSE).

`ExtPay.js` is [ExtPay](https://github.com/Glench/ExtPay) by Glen Chiacchieri, bundled as a separate file. That project's LICENSE file says LGPL-3.0, while its `package.json` and source comment say AGPL. It remains under its own license.

## Contact

Open an issue, or email michael@hydrocomplete.com.
