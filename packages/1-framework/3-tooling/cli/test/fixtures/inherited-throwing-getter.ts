const base = {};
Object.defineProperty(base, 'computed', {
  enumerable: true,
  get() {
    throw new Error('the inherited getter ran');
  },
});

export const contract = Object.assign(Object.create(base), { foo: 'bar' });
