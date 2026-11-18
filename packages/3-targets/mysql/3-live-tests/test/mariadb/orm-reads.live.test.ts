import { describeOrmReads } from '../suites/orm-reads';
import { mariadbLiveServer } from './server';

describeOrmReads(mariadbLiveServer);
