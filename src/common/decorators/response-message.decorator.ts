import { Reflector } from '@nestjs/core';

// The human-readable message put in the response envelope, e.g.
// @ResponseMessage('Availability retrieved successfully')
export const ResponseMessage = Reflector.createDecorator<string>();
