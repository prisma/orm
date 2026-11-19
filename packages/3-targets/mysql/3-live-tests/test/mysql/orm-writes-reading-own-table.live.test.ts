import { describeOrmWritesReadingOwnTable } from '../suites/orm-writes-reading-own-table';
import { mysqlLiveServer } from './server';

describeOrmWritesReadingOwnTable(mysqlLiveServer);
