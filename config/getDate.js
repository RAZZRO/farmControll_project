const moment = require('jalali-moment');
function getTodayJalali() {

    const today = moment();

    // تاریخ شمسی
    const todayJalali = today.locale('fa').format('YYYY/MM/DD');

    // زمان شمسی
    const time = today.format('HH:mm:ss');

    // برگشت لیست یا آرایه که شامل تاریخ و زمان است
    return [todayJalali, time];
}
module.exports = getTodayJalali;