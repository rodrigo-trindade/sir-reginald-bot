// utils/weather.js
// Handles fetching and formatting the weather forecast.

const axios = require('axios');
const { differenceInCalendarDays, format: formatDate } = require('date-fns');

/**
 * Fetches the weather forecast for a given date from the Open-Meteo API.
 * @param {string|Date} date The date for the forecast.
 * @param {object} logger A logger object (like app.logger) to log errors.
 * @returns {Promise<string>} A human-readable weather forecast string.
 */
async function getWeatherForecast(date, logger) {
  try {
      const forecastDate = new Date(date);
      const today = new Date();
      const daysOut = differenceInCalendarDays(forecastDate, today);

      // Open-Meteo supports up to 16 days, but we'll cap it at 14 for reliability.
      if (daysOut < 0 || daysOut > 14) {
          return "The date is too distant for a reliable meteorological report.";
      }
      
      const formattedDate = formatDate(forecastDate, 'yyyy-MM-dd');

      const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
          params: {
              latitude: 59.3293, // Stockholm
              longitude: 18.0686,
              daily: 'weathercode,temperature_2m_max,temperature_2m_min',
              timezone: 'Europe/Stockholm',
              start_date: formattedDate,
              end_date: formattedDate,
          }
      });
      
      if (!response.data || !response.data.daily || !response.data.daily.weathercode) {
           logger.error('Open-Meteo returned an unexpected response format:', response.data);
           return "I find myself unable to retrieve a detailed weather forecast for this date.";
      }

      const daily = response.data.daily;
      const weatherCode = daily.weathercode[0];
      const maxTemp = Math.round(daily.temperature_2m_max[0]);
      const minTemp = Math.round(daily.temperature_2m_min[0]);

      const weatherConditions = {
          0: 'perfectly clear skies', 1: 'mainly clear skies', 2: 'a pleasant smattering of clouds', 3: 'a mostly clouded canopy',
          45: 'the possibility of fog', 48: 'depositing rime fog', 51: 'a light drizzle', 53: 'a moderate drizzle',
          55: 'a dense drizzle', 56: 'light, freezing drizzle', 57: 'dense, freezing drizzle', 61: 'a slight prospect of rain',
          63: 'a moderate prospect of rain', 65: 'a heavy prospect of rain', 66: 'light, freezing rain', 67: 'heavy, freezing rain',
          71: 'a light flurry of snow', 73: 'a moderate flurry of snow', 75: 'a heavy flurry of snow', 77: 'snow grains',
          80: 'slight rain showers', 81: 'moderate rain showers', 82: 'violent rain showers', 85: 'slight snow showers',
          86: 'heavy snow showers', 95: 'the dramatic possibility of a thunderstorm', 96: 'a thunderstorm with slight hail',
          99: 'a thunderstorm with heavy hail'
      };
      const weatherDescription = weatherConditions[weatherCode] || "somewhat uncertain conditions";
      
      return `The forecast anticipates ${weatherDescription}, with temperatures ranging from a low of ${minTemp}°C to a high of ${maxTemp}°C.`;

  } catch (error) {
      logger.error('Error fetching weather forecast. Full error object:', error);
      return "My sincerest apologies, I am unable to consult the almanac at this present time.";
  }
}

module.exports = {
    getWeatherForecast,
};
