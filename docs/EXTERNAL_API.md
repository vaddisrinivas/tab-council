# External API

Tab Council exposes a small extension-to-extension API for companion extensions such as gTabs.

The API does not start council runs or send prompts. It only reports/refreshes the current `tab-council` group.

## Manifest Access

The alpha manifest uses:

```json
{
  "externally_connectable": {
    "ids": ["*"]
  }
}
```

This supports unpacked development builds whose extension IDs are not stable. Before a Chrome Web Store release, replace `*` with the published gTabs extension ID.

## Messages

Send messages with `chrome.runtime.sendMessage(tabCouncilExtensionId, message)`.

### `TC_GET_STATE`

```json
{
  "type": "TC_GET_STATE",
  "payload": {
    "windowId": 123
  }
}
```

Returns active council summary plus current run status/phase.

### `TC_PREPARE_COUNCIL`

```json
{
  "type": "TC_PREPARE_COUNCIL",
  "payload": {
    "windowId": 123,
    "groupName": "tab-council"
  }
}
```

Rescans the requested window for the `tab-council` group and returns the same active council summary.

## Response Shape

```json
{
  "ok": true,
  "apiVersion": 1,
  "activeCouncil": {
    "groupId": 1,
    "windowId": 123,
    "title": "tab-council",
    "color": "blue",
    "tabCount": 3,
    "providers": ["chatgpt", "claude"],
    "updatedAt": 1760000000000
  },
  "runStatus": null,
  "runPhase": null
}
```

Errors return `{ "ok": false, "apiVersion": 1, "error": "..." }`.
