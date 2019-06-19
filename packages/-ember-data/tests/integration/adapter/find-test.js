import { Promise, reject, defer, resolve } from 'rsvp';
import { run } from '@ember/runloop';
import setupStore from 'dummy/tests/helpers/store';
import testInDebug from 'dummy/tests/helpers/test-in-debug';
import { module, test } from 'qunit';
import DS from 'ember-data';
import JSONAPISerializer from 'ember-data/serializers/json-api';

const { attr } = DS;

let Person, store, env;

module('integration/adapter/find - Finding Records', function(hooks) {
  hooks.beforeEach(function() {
    Person = DS.Model.extend({
      updatedAt: attr('string'),
      name: attr('string'),
      firstName: attr('string'),
      lastName: attr('string'),
    });

    env = setupStore({
      person: Person,
    });
    store = env.store;
  });

  hooks.afterEach(function() {
    run(store, 'destroy');
  });

  testInDebug('It raises an assertion when `undefined` is passed as id (#1705)', function(assert) {
    assert.expectAssertion(() => {
      store.find('person', undefined);
    }, `You cannot pass 'undefined' as id to the store's find method`);

    assert.expectAssertion(() => {
      store.find('person', null);
    }, `You cannot pass 'null' as id to the store's find method`);
  });

  test("When a single record is requested, the adapter's find method should be called unless it's loaded.", function(assert) {
    assert.expect(2);

    let count = 0;

    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord(_, type) {
          assert.equal(type, Person, 'the find method is called with the correct type');
          assert.equal(count, 0, 'the find method is only called once');

          count++;
          return {
            data: {
              id: 1,
              type: 'person',
              attributes: {
                name: 'Braaaahm Dale',
              },
            },
          };
        },
      })
    );

    run(() => {
      store.findRecord('person', 1);
      store.findRecord('person', 1);
    });
  });

  test('When a single record is requested multiple times, all .findRecord() calls are resolved after the promise is resolved', function(assert) {
    let deferred = defer();

    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord() {
          return deferred.promise;
        },
      })
    );

    let requestOne = run(() => {
      return store.findRecord('person', 1).then(person => {
        assert.equal(person.get('id'), '1');
        assert.equal(person.get('name'), 'Braaaahm Dale');
      });
    });

    let requestTwo = run(() => {
      return store.findRecord('person', 1).then(post => {
        assert.equal(post.get('id'), '1');
        assert.equal(post.get('name'), 'Braaaahm Dale');
      });
    });

    run(() => {
      deferred.resolve({
        data: {
          id: 1,
          type: 'person',
          attributes: {
            name: 'Braaaahm Dale',
          },
        },
      });
    });

    return Promise.all([requestOne, requestTwo]);
  });

  test('When a single record is requested multiple times, and the id of the primary resource is different than the requested id, reload: true is honored', function(assert) {
    let deferred;
    let requestCount = 0;

    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord() {
          ++requestCount;
          deferred = defer();
          return deferred.promise;
        },
      })
    );

    let response = {
      data: {
        id: 'person:1',
        type: 'person',
        attributes: {
          name: 'Someone',
        },
      },
    };

    let requestOne = run(() => {
      return store.findRecord('person', 1).then(person => {
        assert.equal(person.get('id'), 'person:1', 'request 1 person.id');
        assert.equal(person.get('name'), 'Someone', 'request 1 person.name');
      });
    });

    run(() => deferred.resolve(response));

    let requestTwo = run(() => {
      return store.findRecord('person', 1, { reload: true }).then(post => {
        assert.equal(post.get('id'), 'person:1', 'request 2 person.id');
        assert.equal(post.get('name'), 'Someone', 'request 2 person.name');
      });
    });

    run(() => deferred.resolve(response));

    return Promise.all([requestOne, requestTwo]).then(() => {
      assert.equal(requestCount, 2, 'another request is fired when reload: true is given');
    });
  });

  test('When a single record is requested, and the promise is rejected, .findRecord() is rejected.', function(assert) {
    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord() {
          return reject();
        },
      })
    );

    return run(() => {
      return store.findRecord('person', 1).catch(() => {
        assert.ok(true, 'The rejection handler was called');
      });
    });
  });

  test('When a single record is requested, and the promise is rejected, the record should be unloaded.', function(assert) {
    assert.expect(2);

    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord() {
          return reject();
        },
      })
    );

    return run(() => {
      return store.findRecord('person', 1).catch(reason => {
        assert.ok(true, 'The rejection handler was called');
        assert.ok(!store.hasRecordForId('person', 1), 'The record has been unloaded');
      });
    });
  });

  testInDebug('When a single record is requested, and the payload is blank', function(assert) {
    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord: () => resolve({}),
      })
    );

    assert.expectAssertion(() => {
      run(() => store.findRecord('person', 'the-id'));
    }, /You made a 'findRecord' request for a 'person' with id 'the-id', but the adapter's response did not have any data/);
  });

  testInDebug('When multiple records are requested, and the payload is blank', function(assert) {
    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        coalesceFindRequests: true,
        findMany: () => resolve({}),
      })
    );

    assert.expectAssertion(() => {
      run(() => {
        store.findRecord('person', '1');
        store.findRecord('person', '2');
      });
    }, /You made a 'findMany' request for 'person' records with ids '\[1,2\]', but the adapter's response did not have any data/);
  });

  testInDebug('warns when returned record has different id', function(assert) {
    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord() {
          return {
            data: {
              id: 1,
              type: 'person',
              attributes: {
                name: 'Braaaahm Dale',
              },
            },
          };
        },
      })
    );

    assert.expectWarning(
      () => run(() => env.store.findRecord('person', 'me')),
      /You requested a record of type 'person' with id 'me' but the adapter returned a payload with primary data having an id of '1'/
    );
  });

  testInDebug('coerces ids before warning when returned record has different id', async function(
    assert
  ) {
    env.owner.register(
      'serializer:application',
      JSONAPISerializer.extend({
        normalizeResponse(_, __, payload) {
          return payload;
        },
      })
    );

    env.owner.register(
      'adapter:person',
      DS.Adapter.extend({
        findRecord() {
          return {
            data: {
              id: 1,
              type: 'person',
              attributes: {
                name: 'Braaaahm Dale',
              },
            },
          };
        },
      })
    );

    assert.expectNoWarning(
      () => run(() => env.store.findRecord('person', 1)),
      /You requested a record of type 'person' with id '1' but the adapter returned a payload with primary data having an id of '1'/
    );
    assert.expectNoWarning(
      () => run(() => env.store.findRecord('person', '1')),
      /You requested a record of type 'person' with id '1' but the adapter returned a payload with primary data having an id of '1'/
    );
  });
});
