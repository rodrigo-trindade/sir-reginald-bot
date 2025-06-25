// utils/date.js
// Contains date-related helper functions.

const { addWeeks, format: formatDate, startOfWeek } = require('date-fns');

/**
 * Calculates a booking date for a number of weeks in the future, landing on a Monday.
 * @param {number} weeks The number of weeks ahead to book.
 * @returns {{dateString: string, fullDate: string}} An object with formatted and ISO date strings.
 */
function getBookingDateForWeeksAhead(weeks) {
  const now = new Date();
  const thisWeeksMonday = startOfWeek(now, { weekStartsOn: 1 });
  thisWeeksMonday.setHours(0, 0, 0, 0);
  const bookingDateObj = addWeeks(thisWeeksMonday, weeks);
  return {
      dateString: formatDate(bookingDateObj, "EEEE, MMMM do"),
      fullDate: bookingDateObj.toISOString()
  };
}

module.exports = {
    getBookingDateForWeeksAhead,
};
