import { describeOrmIncludes } from '../../../../1-mysql/9-facade/test/runtime/suites/orm-includes';
import { mariadbLiveServer } from './live-servers';

describeOrmIncludes(mariadbLiveServer);
