const { defineContract, field, model, type } = require('@internal/mongo/contract-builder');

const User = model('User', { collection: 'users', fields: { _id: field.scalar(type.ObjectId()) } });

module.exports = defineContract({ models: { User } });
