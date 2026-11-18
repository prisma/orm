import { describeOrmWrites } from '../suites/orm-writes';
import { mariadbLiveServer } from './server';

describeOrmWrites(mariadbLiveServer);
