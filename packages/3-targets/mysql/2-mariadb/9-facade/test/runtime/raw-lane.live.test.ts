import { describeRawLane } from '../../../../1-mysql/9-facade/test/runtime/suites/raw-lane';
import { mariadbLiveServer } from './live-servers';

describeRawLane(mariadbLiveServer);
