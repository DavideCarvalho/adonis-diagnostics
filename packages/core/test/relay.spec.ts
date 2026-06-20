import { describe, expect, it } from 'vitest';
import { emit, getChannel } from '../src/channel.js';
import { createChannelSelector, parseChannelName } from '../src/relay.js';

describe('parseChannelName', () => {
  it('splits on the first colon after the prefix, keeping dots in the event', () => {
    expect(parseChannelName('agora:durable:run.failed')).toEqual({
      lib: 'durable',
      event: 'run.failed',
    });
  });

  it('keeps later colons as part of the event', () => {
    expect(parseChannelName('agora:billing:invoice:paid')).toEqual({
      lib: 'billing',
      event: 'invoice:paid',
    });
  });

  it('rejects names that do not match the convention', () => {
    expect(parseChannelName('other:x:y')).toBeNull(); // wrong prefix
    expect(parseChannelName('agora:x')).toBeNull(); // no event segment
    expect(parseChannelName('agora:x:')).toBeNull(); // empty event
    expect(parseChannelName('agora::y')).toBeNull(); // empty lib
  });
});

describe('createChannelSelector', () => {
  it('forwards an exact channel and stops on teardown', () => {
    const seen: unknown[] = [];
    const selector = createChannelSelector({ channels: [{ lib: 'sel1', event: 'e' }] }, (m) =>
      seen.push(m),
    );
    emit('sel1', 'e', { n: 1 });
    expect(seen).toHaveLength(1);
    selector.stop();
    emit('sel1', 'e', { n: 2 });
    expect(seen).toHaveLength(1);
  });

  it('forwards every channel of a wildcard lib, including ones registered later', () => {
    const seen: unknown[] = [];
    getChannel('sel2', 'existing'); // registered before the selector starts
    const selector = createChannelSelector({ libs: ['sel2'] }, (m) => seen.push(m));
    emit('sel2', 'existing', { a: 1 });
    emit('sel2', 'brand-new', { a: 2 }); // channel first registered now
    emit('other', 'x', { a: 3 }); // different lib — not forwarded
    expect(seen).toHaveLength(2);
    selector.stop();
  });

  it('with all:true forwards every agora channel', () => {
    const seen: unknown[] = [];
    const selector = createChannelSelector({ all: true }, (m) => seen.push(m));
    emit('sel3', 'a', {});
    emit('sel4', 'b', {});
    expect(seen).toHaveLength(2);
    selector.stop();
  });

  it('subscribes a channel at most once', () => {
    const seen: unknown[] = [];
    const selector = createChannelSelector(
      {
        channels: [
          { lib: 'sel5', event: 'e' },
          { lib: 'sel5', event: 'e' },
        ],
      },
      (m) => seen.push(m),
    );
    emit('sel5', 'e', {});
    expect(seen).toHaveLength(1);
    selector.stop();
  });
});
