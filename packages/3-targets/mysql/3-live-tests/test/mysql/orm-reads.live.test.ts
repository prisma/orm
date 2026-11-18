import { describeOrmReads } from '../suites/orm-reads';
import { mysqlLiveServer } from './server';

describeOrmReads(mysqlLiveServer);
