import { mysqlLiveServer } from './live-servers';
import { describeOrmReads } from './suites/orm-reads';

describeOrmReads(mysqlLiveServer);
