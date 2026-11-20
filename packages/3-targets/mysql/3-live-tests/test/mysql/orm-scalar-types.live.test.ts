import { describeOrmScalarTypes } from '../suites/orm-scalar-types';
import { mysqlLiveServer } from './server';

describeOrmScalarTypes(mysqlLiveServer);
