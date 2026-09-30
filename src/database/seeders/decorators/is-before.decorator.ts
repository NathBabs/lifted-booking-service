import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

function isDateInput(value: unknown): value is string | number | Date {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof Date
  );
}

export function IsBefore(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBefore',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: {
        message: `${propertyName} must be chronologically before ${property}`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];

          if (!isDateInput(value) || !isDateInput(relatedValue)) {
            return false;
          }

          const startDate = new Date(value);
          const endDate = new Date(relatedValue);

          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return false;
          }

          return startDate.getTime() < endDate.getTime();
        },
      },
    });
  };
}
