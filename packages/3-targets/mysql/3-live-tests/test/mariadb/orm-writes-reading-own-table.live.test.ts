import { describeOrmWritesReadingOwnTable } from '../suites/orm-writes-reading-own-table';
import { mariadbLiveServer } from './server';

describeOrmWritesReadingOwnTable(mariadbLiveServer);
