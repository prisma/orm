import { describeOrmWrites } from '../suites/orm-writes';
import { mysqlLiveServer } from './server';

describeOrmWrites(mysqlLiveServer);
