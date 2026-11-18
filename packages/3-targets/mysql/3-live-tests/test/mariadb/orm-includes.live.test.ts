import { describeOrmIncludes } from '../suites/orm-includes';
import { mariadbLiveServer } from './server';

describeOrmIncludes(mariadbLiveServer);
