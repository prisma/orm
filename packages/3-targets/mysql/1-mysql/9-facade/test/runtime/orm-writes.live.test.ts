import { mysqlLiveServer } from './live-servers';
import { describeOrmWrites } from './suites/orm-writes';

describeOrmWrites(mysqlLiveServer);
