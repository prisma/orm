import { describeOrmScalarTypes } from '../suites/orm-scalar-types';
import { mariadbLiveServer } from './server';

describeOrmScalarTypes(mariadbLiveServer);
