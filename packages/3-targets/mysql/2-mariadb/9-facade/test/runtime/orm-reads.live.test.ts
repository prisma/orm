import { describeOrmReads } from '../../../../1-mysql/9-facade/test/runtime/suites/orm-reads';
import { mariadbLiveServer } from './live-servers';

describeOrmReads(mariadbLiveServer);
