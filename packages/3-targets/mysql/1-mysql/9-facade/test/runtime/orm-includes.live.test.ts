import { mysqlLiveServer } from './live-servers';
import { describeOrmIncludes } from './suites/orm-includes';

describeOrmIncludes(mysqlLiveServer);
