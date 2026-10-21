-- Vuxenkonton skapas och kopplas till familjen av edge function (adult_signup / adult_join),
-- bara för e-post i ALLOWED_EMAILS. Klienten får inte längre skapa egna familjer.
revoke execute on function public.create_household(text) from authenticated;
