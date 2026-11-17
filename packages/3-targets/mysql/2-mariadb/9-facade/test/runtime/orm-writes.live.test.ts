import { describeOrmWrites } from '../../../../1-mysql/9-facade/test/runtime/suites/orm-writes';
import { mariadbLiveServer } from './live-servers';

describeOrmWrites(mariadbLiveServer);
