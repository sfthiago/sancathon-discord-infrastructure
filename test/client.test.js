import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { Events } from "discord.js";

import { loginDiscordClient } from "../src/discord/client.js";

class FakeClient extends EventEmitter {
  constructor({ ready = false, emitReady = false } = {}) {
    super();
    this.ready = ready;
    this.emitReady = emitReady;
  }

  isReady() {
    return this.ready;
  }

  async login() {
    if (this.emitReady) {
      setImmediate(() => {
        this.ready = true;
        this.emit(Events.ClientReady, this);
      });
    }
    return "TOKEN_SENTINEL_MUST_NOT_BE_RETURNED";
  }
}

test("Discord login waits for ClientReady and never returns the token", async () => {
  const client = new FakeClient({ emitReady: true });
  const result = await loginDiscordClient(client, "safe-test-token", {
    timeoutMs: 1_000,
  });

  assert.equal(client.isReady(), true);
  assert.equal(result, undefined);
  assert.equal(client.listenerCount(Events.ClientReady), 0);
  assert.equal(client.listenerCount(Events.Error), 0);
});

test("Discord login fails clearly if readiness times out", async () => {
  const client = new FakeClient();

  await assert.rejects(
    loginDiscordClient(client, "safe-test-token", { timeoutMs: 5 }),
    /Discord nao ficou pronto/u,
  );
  assert.equal(client.listenerCount(Events.ClientReady), 0);
  assert.equal(client.listenerCount(Events.Error), 0);
});
