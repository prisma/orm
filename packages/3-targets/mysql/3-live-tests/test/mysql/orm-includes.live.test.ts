import { describeOrmIncludes } from '../suites/orm-includes';
import { mysqlLiveServer } from './server';

describeOrmIncludes(mysqlLiveServer);
